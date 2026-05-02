"""Coordinator service — autonomous task delegation plan generation."""

import json
import re
import uuid

import anthropic
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.models.room import Room


async def generate_coordinator_plan(db: AsyncSession, room_id: uuid.UUID) -> dict:
    """Generate a task assignment plan via Claude and persist it on the room.

    Returns the coordinator_plan dict:
    {"assignments": [{"agent_id": str, "agent_name": str, "subtask": str}, ...], "summary": str}
    """
    result = await db.execute(
        select(Room).options(selectinload(Room.contract)).where(Room.room_id == room_id)
    )
    room = result.scalar_one_or_none()
    if not room:
        raise ValueError("Room not found.")
    if not room.session_graph:
        raise ValueError("Session graph not set for this room.")

    task_description = room.contract.task_description if room.contract else "No task description."
    agents = room.session_graph.get("agents", [])

    # Only include non-Coordinator, non-human, non-Observer agents in the plan
    assignable = [
        a for a in agents
        if not a.get("is_human", False)
        and a.get("role", "") not in ("Coordinator", "Observer")
    ]

    if not assignable:
        raise ValueError("No assignable agents found in session graph.")

    agents_list = "\n".join(
        f'- id="{a["id"]}" name="{a.get("name", a["id"])}" role="{a.get("role", "Contributor")}"'
        for a in assignable
    )

    from app.config import settings
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key if settings.anthropic_api_key else None)

    system = (
        "You are a Coordinator AI that decomposes a task into focused subtasks for a team of agents. "
        "Respond ONLY with valid JSON matching exactly: "
        '{"assignments": [{"agent_id": "<id>", "agent_name": "<name>", "subtask": "<1-2 sentence focused subtask>"}], '
        '"summary": "<one paragraph team coordination summary>"}'
    )
    user_msg = (
        f"Task: {task_description}\n\n"
        f"Team agents:\n{agents_list}\n\n"
        "Generate a concise subtask for each agent based on their role and the overall task. "
        "Each subtask should be specific, actionable, and complement the other agents' work. "
        "Respond ONLY with the JSON."
    )

    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    )

    text = next((b.text for b in response.content if b.type == "text"), "{}")

    # Extract JSON from response
    json_match = re.search(r'\{[\s\S]*\}', text)
    plan: dict = {}
    if json_match:
        try:
            plan = json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    # Validate and fill missing agents
    existing_ids = {a["agent_id"] for a in plan.get("assignments", [])}
    assignments = list(plan.get("assignments", []))
    for a in assignable:
        if a["id"] not in existing_ids:
            assignments.append({
                "agent_id": a["id"],
                "agent_name": a.get("name", a["id"]),
                "subtask": f"Contribute to the task: {task_description[:100]}",
            })

    plan = {
        "assignments": assignments,
        "summary": plan.get("summary", "Team will collaborate to complete the task."),
    }

    room.coordinator_plan = plan
    db.add(room)
    await db.flush()

    return plan


def get_agent_subtask(room: Room, agent_id: str) -> str | None:
    """Return the coordinator-assigned subtask for an agent, or None if not found."""
    if not room.coordinator_plan:
        return None
    for assignment in room.coordinator_plan.get("assignments", []):
        if assignment.get("agent_id") == agent_id:
            return assignment.get("subtask")
    return None

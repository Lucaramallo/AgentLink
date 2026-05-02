"""Dataset service — capture collaborative behavior data for every terminal session."""

import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.config import settings
from app.models.dataset import AgentDataset, FailureReason, SessionDataset, SessionFeedback
from app.models.room import MessageType, Poll, PollStatus, Room

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------------
# Keyword extraction
# ---------------------------------------------------------------------------

async def extract_task_keywords(task_description: str) -> list[str]:
    """Call Claude haiku to extract up to 10 topic keywords from a task description.

    Returns an empty list on any failure so the caller is never blocked.
    """
    if not settings.anthropic_api_key:
        return []
    try:
        import anthropic  # type: ignore

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        msg = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=128,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Extract up to 10 short topic keywords from this task description. "
                        "Return ONLY a JSON array of strings, no other text.\n\n"
                        f"Task: {task_description[:1000]}"
                    ),
                }
            ],
        )
        raw: str = msg.content[0].text.strip()
        # Strip markdown code fences if present
        raw = re.sub(r"^```[a-z]*\n?|```$", "", raw, flags=re.MULTILINE).strip()
        keywords = json.loads(raw)
        if isinstance(keywords, list):
            return [str(k) for k in keywords[:10]]
    except Exception:
        pass
    return []


# ---------------------------------------------------------------------------
# Main collection
# ---------------------------------------------------------------------------

async def collect_session_data(
    db: "AsyncSession",
    room_id: uuid.UUID,
    outcome: str,
    human_team_rating: float | None = None,
    average_peer_rating: float | None = None,
    feedback: "SessionFeedback | None" = None,
) -> None:
    """Build and upsert SessionDataset + AgentDataset for any terminal outcome.

    This function is designed to be called as an asyncio background task so it
    never blocks the HTTP response.  It uses its own commit to avoid interfering
    with the caller's transaction.
    """
    try:
        room: Room | None = await db.get(Room, room_id)
        if room is None:
            return

        # ── Compute duration ─────────────────────────────────────────────────
        duration_seconds: int | None = None
        if room.created_at and room.closed_at:
            duration_seconds = int((room.closed_at - room.created_at).total_seconds())

        # ── Task description (from contract) ─────────────────────────────────
        task_description: str = ""
        if room.contract_id:
            from app.models.room import RoomContract
            contract = await db.get(RoomContract, room.contract_id)
            if contract:
                task_description = contract.task_description

        # ── Keywords ─────────────────────────────────────────────────────────
        task_keywords: list[str] = []
        if task_description:
            task_keywords = await extract_task_keywords(task_description)

        # ── Messages ─────────────────────────────────────────────────────────
        from app.models.room import Message
        msgs_result = await db.execute(
            select(Message).where(Message.room_id == room_id)
        )
        messages = msgs_result.scalars().all()

        # Deliverable format detection
        deliverable_format: str | None = None
        for m in messages:
            if m.message_type == MessageType.DELIVERABLE:
                content_lower = (m.content_natural or "").lower()
                if "<html" in content_lower or "<!doctype" in content_lower:
                    deliverable_format = "html"
                elif any(k in content_lower for k in (",", "csv", "spreadsheet")):
                    deliverable_format = "csv"
                else:
                    deliverable_format = "md"
                break

        # Round count — infer from SYSTEM messages: "Round N — ..."
        round_numbers: set[int] = set()
        for m in messages:
            if m.message_type == MessageType.SYSTEM:
                match = re.search(r"\bRound\s+(\d+)", m.content_natural or "", re.IGNORECASE)
                if match:
                    round_numbers.add(int(match.group(1)))
        number_of_rounds_used = max(round_numbers) if round_numbers else 0

        # ── Polls ─────────────────────────────────────────────────────────────
        polls_result = await db.execute(
            select(Poll).where(Poll.room_id == room_id)
        )
        polls = polls_result.scalars().all()
        number_of_polls = len(polls)
        number_of_polls_vetoed = sum(1 for p in polls if p.status == PollStatus.VETOED)

        # ── Session graph data ────────────────────────────────────────────────
        graph = room.session_graph or {}
        agents_in_graph: list[dict] = graph.get("agents", [])
        edges_in_graph: list[dict] = graph.get("edges", [])

        number_of_agents = len([a for a in agents_in_graph if not a.get("is_human", False)])
        had_human_node = any(a.get("is_human", False) for a in agents_in_graph)
        roles_present = list({a.get("role", "Unknown") for a in agents_in_graph})
        agent_slugs = [a.get("name", a.get("id", "")) for a in agents_in_graph if not a.get("is_human", False)]
        edge_count = len(edges_in_graph)
        # Cluster count: distinct cluster ids if stored, else 0
        cluster_ids = {a.get("clusterId") for a in agents_in_graph if a.get("clusterId")}
        cluster_count = len(cluster_ids)

        # ── Feedback fields ───────────────────────────────────────────────────
        fb_reason: str | None = None
        fb_text: str | None = None
        fb_retry: bool | None = None
        if feedback:
            fb_reason = feedback.failure_reason.value if feedback.failure_reason else None
            fb_text = feedback.failure_free_text
            fb_retry = feedback.would_retry

        # ── Upsert SessionDataset ─────────────────────────────────────────────
        existing_result = await db.execute(
            select(SessionDataset).where(SessionDataset.session_id == room_id)
        )
        sd: SessionDataset | None = existing_result.scalar_one_or_none()

        if sd is None:
            sd = SessionDataset(
                session_id=room_id,
                created_at=room.created_at,
                closed_at=room.closed_at,
                duration_seconds=duration_seconds,
                task_description=task_description,
                task_keywords=task_keywords,
                number_of_agents=number_of_agents,
                number_of_rounds_used=number_of_rounds_used,
                number_of_polls=number_of_polls,
                number_of_polls_vetoed=number_of_polls_vetoed,
                final_outcome=outcome,
                deliverable_format=deliverable_format,
                human_team_rating=human_team_rating,
                average_peer_rating=average_peer_rating,
                failure_reason=fb_reason,
                failure_free_text=fb_text,
                would_retry=fb_retry,
                roles_present=roles_present,
                agent_slugs=agent_slugs,
                had_human_node=had_human_node,
                cluster_count=cluster_count,
                edge_count=edge_count,
            )
            db.add(sd)
        else:
            # Patch mutable fields that may have changed (e.g. feedback arrived after initial write)
            sd.final_outcome = outcome
            sd.closed_at = room.closed_at
            sd.duration_seconds = duration_seconds
            if human_team_rating is not None:
                sd.human_team_rating = human_team_rating
            if average_peer_rating is not None:
                sd.average_peer_rating = average_peer_rating
            if fb_reason:
                sd.failure_reason = fb_reason
            if fb_text:
                sd.failure_free_text = fb_text
            if fb_retry is not None:
                sd.would_retry = fb_retry
            if not sd.task_keywords and task_keywords:
                sd.task_keywords = task_keywords
                flag_modified(sd, "task_keywords")

        await db.flush()

        # ── Delete old AgentDataset rows (idempotent re-write) ────────────────
        from sqlalchemy import delete as sa_delete
        await db.execute(
            sa_delete(AgentDataset).where(AgentDataset.session_id == room_id)
        )

        # ── Build per-agent message counts ────────────────────────────────────
        sender_counts: dict[str, int] = {}
        for m in messages:
            if m.message_type not in (MessageType.SYSTEM, MessageType.POLL_EVENT):
                sid = str(m.sender_agent_id)
                sender_counts[sid] = sender_counts.get(sid, 0) + 1

        total_non_system = sum(sender_counts.values()) or 1

        # ── Build poll stats per agent ────────────────────────────────────────
        polls_proposed_map: dict[str, int] = {}
        polls_voted_map: dict[str, int] = {}
        for p in polls:
            if p.proposed_by_type == "agent":
                polls_proposed_map[p.proposed_by] = polls_proposed_map.get(p.proposed_by, 0) + 1
            for vote in (p.votes or []):
                vid = vote.get("voter_id", "")
                if vote.get("voter_type") == "agent":
                    polls_voted_map[vid] = polls_voted_map.get(vid, 0) + 1

        # Flagged agents from feedback
        flagged_ids: set[str] = set()
        if feedback and feedback.problematic_agent_ids:
            flagged_ids = set(str(x) for x in feedback.problematic_agent_ids)

        # ── Write AgentDataset rows ───────────────────────────────────────────
        for agent in agents_in_graph:
            if agent.get("is_human", False):
                continue
            aid = str(agent.get("id", ""))
            slug = agent.get("name", aid)
            role = agent.get("role", "Contributor")

            # Fetch current reputation from DB if possible
            final_rep: float | None = None
            try:
                from app.models.agent import Agent as AgentModel
                agent_row = await db.get(AgentModel, uuid.UUID(aid))
                if agent_row:
                    final_rep = agent_row.reputation_technical
            except (ValueError, Exception):
                pass

            msgs_sent = sender_counts.get(aid, 0)
            msgs_received = total_non_system - msgs_sent if total_non_system > msgs_sent else 0

            ad = AgentDataset(
                session_id=room_id,
                agent_id=aid,
                agent_slug=slug,
                role=role,
                messages_sent=msgs_sent,
                messages_received=msgs_received,
                rounds_participated=number_of_rounds_used if msgs_sent > 0 else 0,
                peer_rating_received=None,
                human_rating_received=None,
                final_reputation_score=final_rep,
                response_time_avg_seconds=None,
                was_skipped=False,
                polls_proposed=polls_proposed_map.get(aid, 0),
                polls_voted=polls_voted_map.get(aid, 0),
                flagged_as_problem=(aid in flagged_ids),
            )
            db.add(ad)

        await db.commit()

    except Exception:
        await db.rollback()


# ---------------------------------------------------------------------------
# Rating patch (called after CONFORME rating screen completes)
# ---------------------------------------------------------------------------

async def update_session_ratings(
    db: "AsyncSession",
    room_id: uuid.UUID,
    human_team_rating: float | None,
    average_peer_rating: float | None,
    per_agent_peer_scores: "dict[str, float] | None" = None,
    per_agent_human_scores: "dict[str, float] | None" = None,
) -> None:
    """Patch the rating columns on an existing SessionDataset row, and update AgentDataset.

    Called from the reputation/session-update endpoint after ratings are submitted.
    Non-blocking — designed to run as a background task.
    """
    try:
        sd_result = await db.execute(
            select(SessionDataset).where(SessionDataset.session_id == room_id)
        )
        sd: SessionDataset | None = sd_result.scalar_one_or_none()
        if sd is None:
            return

        if human_team_rating is not None:
            sd.human_team_rating = human_team_rating
        if average_peer_rating is not None:
            sd.average_peer_rating = average_peer_rating

        # Patch per-agent rows
        if per_agent_peer_scores or per_agent_human_scores:
            ad_result = await db.execute(
                select(AgentDataset).where(AgentDataset.session_id == room_id)
            )
            agent_rows = ad_result.scalars().all()
            for ar in agent_rows:
                if per_agent_peer_scores and ar.agent_id in per_agent_peer_scores:
                    ar.peer_rating_received = per_agent_peer_scores[ar.agent_id]
                if per_agent_human_scores and ar.agent_id in per_agent_human_scores:
                    ar.human_rating_received = per_agent_human_scores[ar.agent_id]

        await db.commit()

    except Exception:
        await db.rollback()


# ---------------------------------------------------------------------------
# Feedback persistence
# ---------------------------------------------------------------------------

async def save_feedback(
    db: "AsyncSession",
    room_id: uuid.UUID,
    failure_reason: FailureReason,
    failure_free_text: str,
    problematic_agent_ids: "list[str] | None",
    would_retry: bool,
) -> SessionFeedback:
    """Persist a SessionFeedback row. Raises ValueError if free text is too short."""
    if len(failure_free_text.strip()) < 20:
        raise ValueError("failure_free_text must be at least 20 characters.")

    fb = SessionFeedback(
        session_id=room_id,
        failure_reason=failure_reason,
        failure_free_text=failure_free_text.strip(),
        problematic_agent_ids=problematic_agent_ids or [],
        would_retry=would_retry,
    )
    db.add(fb)
    await db.flush()
    return fb

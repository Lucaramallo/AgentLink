"""Router de Sesiones — recomendación de equipo de agentes."""

import os
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.recommendation_service import recommend_team as _recommend_team

router = APIRouter(prefix="/sessions", tags=["sessions"])


class RecommendTeamRequest(BaseModel):
    task_description: str
    acceptance_criteria: str = ""
    budget_max: float | None = None


@router.post("/recommend-team")
async def recommend_team(
    body: RecommendTeamRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    agent_list = await _recommend_team(
        db,
        task_description=body.task_description,
        acceptance_criteria=body.acceptance_criteria,
        max_agents=5,
    )

    if not agent_list:
        return {
            "agents": [],
            "edges": [],
            "estimated_cost": 0,
            "reasoning": "No agents available.",
        }

    edges = [
        {"a": agent_list[i]["agent_id"], "b": agent_list[j]["agent_id"]}
        for i in range(len(agent_list))
        for j in range(i + 1, len(agent_list))
    ]

    estimated_msgs_per_agent = 10
    estimated_cost = sum(
        a["session_fee"] + estimated_msgs_per_agent * a["cost_per_message"]
        for a in agent_list
    )

    # Determine reasoning summary based on which path was taken
    has_history = any(
        a.get("reason", "") != "No history yet — recommended by skills"
        for a in agent_list
    )
    if has_history:
        reasoning = (
            f"Recommended {len(agent_list)} agents based on historical performance "
            f"in similar sessions. Scored by ratings (70%), efficiency (20%), "
            f"and current reputation (10%)."
        )
    else:
        reasoning = (
            f"Matched {len(agent_list)} agents based on task keywords. "
            f"Ranked by reputation, price competitiveness, and experience."
        )

    return {
        "agents": agent_list,
        "edges": edges,
        "estimated_cost": round(estimated_cost, 2),
        "reasoning": reasoning,
    }


_TEXT_EXTS: frozenset[str] = frozenset({
    ".txt", ".md", ".py", ".js", ".ts", ".jsx", ".tsx",
    ".json", ".csv", ".yaml", ".yml", ".toml", ".html", ".css", ".sql",
})
_MAX_BYTES = 50 * 1024  # 50 KB per file


@router.post("/upload-files")
async def upload_files(files: list[UploadFile] = File(...)) -> dict:
    """Accept uploaded files and return their text content as a context string for agents."""
    parts: list[str] = []
    for f in files:
        name = f.filename or "unknown"
        ext = os.path.splitext(name)[1].lower()
        raw = await f.read()
        if ext in _TEXT_EXTS:
            content = raw[:_MAX_BYTES].decode("utf-8", errors="replace")
            truncated = len(raw) > _MAX_BYTES
            header = f"[File: {name}{' — truncated to 50 KB' if truncated else ''}]"
            parts.append(f"{header}\n{content}")
        else:
            parts.append(f"[File: {name} — binary/unsupported format, use filename for context]")
    return {"file_context": "\n\n---\n\n".join(parts)}

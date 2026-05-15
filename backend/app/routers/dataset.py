"""Dataset router — collaborative behavior dataset endpoints."""

import asyncio
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.dataset import AgentDataset, FailureReason, SessionDataset, SessionFeedback
from app.models.user import User, UserRole
from app.services.dataset_service import collect_session_data, save_feedback

router = APIRouter(prefix="/dataset", tags=["dataset"])


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _require_superadmin(current_user: User) -> User:
    if current_user.role != UserRole.SUPERADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SUPERADMIN required.")
    return current_user


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class FeedbackPayload(BaseModel):
    session_id: uuid.UUID
    failure_reason: str
    failure_free_text: str
    problematic_agent_ids: list[str] = []
    would_retry: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/feedback", status_code=status.HTTP_201_CREATED)
async def submit_session_feedback(
    payload: FeedbackPayload,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Save mandatory failure feedback and trigger dataset collection as a background task.

    Accessible to any authenticated user — called from the session feedback modal.
    """
    try:
        reason = FailureReason(payload.failure_reason)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid failure_reason: {payload.failure_reason}")

    try:
        feedback = await save_feedback(
            db=db,
            room_id=payload.session_id,
            failure_reason=reason,
            failure_free_text=payload.failure_free_text,
            problematic_agent_ids=payload.problematic_agent_ids,
            would_retry=payload.would_retry,
        )
        await db.commit()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Determine outcome from room status
    from app.models.room import Room
    room = await db.get(Room, payload.session_id)
    outcome = "UNKNOWN"
    if room:
        outcome_map = {
            "CLOSED":   "NO_CONFORME",
            "DISPUTED": "DISPUTED",
            "ARCHIVED": "INCOMPLETE",
        }
        # Use actual room outcome if present
        if room.outcome:
            o = room.outcome.value
            outcome_map2 = {
                "SUCCESS":    "CONFORME",
                "DISPUTE":    "DISPUTED",
                "TIMEOUT":    "INCOMPLETE",
                "INCOMPLETE": "INCOMPLETE",
            }
            outcome = outcome_map2.get(o, o)
        else:
            outcome = outcome_map.get(room.status.value, room.status.value)

    asyncio.create_task(
        collect_session_data(
            room_id=payload.session_id,
            outcome=outcome,
            feedback=feedback,
        )
    )

    return {"ok": True, "feedback_id": str(feedback.feedback_id)}


@router.get("/sessions")
async def list_dataset_sessions(
    page: int = 1,
    limit: int = 50,
    outcome: str = "",
    db: Annotated[AsyncSession, Depends(get_db)] = ...,
    current_user: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """Paginated session dataset. SUPERADMIN only."""
    _require_superadmin(current_user)
    offset = (page - 1) * limit

    q = select(SessionDataset).order_by(desc(SessionDataset.recorded_at))
    if outcome:
        q = q.where(SessionDataset.final_outcome == outcome)

    total_q = select(func.count()).select_from(SessionDataset)
    if outcome:
        total_q = total_q.where(SessionDataset.final_outcome == outcome)

    total = (await db.execute(total_q)).scalar_one()
    rows = (await db.execute(q.offset(offset).limit(limit))).scalars().all()

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "sessions": [_serialize_session_dataset(r) for r in rows],
    }


@router.get("/agents")
async def list_dataset_agents(
    page: int = 1,
    limit: int = 50,
    db: Annotated[AsyncSession, Depends(get_db)] = ...,
    current_user: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """Paginated agent dataset. SUPERADMIN only."""
    _require_superadmin(current_user)
    offset = (page - 1) * limit

    total = (await db.execute(select(func.count()).select_from(AgentDataset))).scalar_one()
    rows = (
        await db.execute(
            select(AgentDataset).order_by(desc(AgentDataset.agent_dataset_id)).offset(offset).limit(limit)
        )
    ).scalars().all()

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "agents": [_serialize_agent_dataset(r) for r in rows],
    }


@router.get("/feedback")
async def list_dataset_feedback(
    page: int = 1,
    limit: int = 50,
    db: Annotated[AsyncSession, Depends(get_db)] = ...,
    current_user: Annotated[User, Depends(get_current_user)] = ...,
) -> dict:
    """Paginated feedback entries. SUPERADMIN only."""
    _require_superadmin(current_user)
    offset = (page - 1) * limit

    total = (await db.execute(select(func.count()).select_from(SessionFeedback))).scalar_one()
    rows = (
        await db.execute(
            select(SessionFeedback).order_by(desc(SessionFeedback.created_at)).offset(offset).limit(limit)
        )
    ).scalars().all()

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "feedback": [_serialize_feedback(r) for r in rows],
    }


@router.get("/export")
async def export_dataset(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Full dataset export — all sessions, agents, and feedback. SUPERADMIN only."""
    _require_superadmin(current_user)

    sessions = (await db.execute(select(SessionDataset).order_by(SessionDataset.recorded_at))).scalars().all()
    agents   = (await db.execute(select(AgentDataset))).scalars().all()
    feedback = (await db.execute(select(SessionFeedback).order_by(SessionFeedback.created_at))).scalars().all()

    return {
        "exported_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "sessions":  [_serialize_session_dataset(r) for r in sessions],
        "agents":    [_serialize_agent_dataset(r) for r in agents],
        "feedback":  [_serialize_feedback(r) for r in feedback],
    }


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

def _serialize_session_dataset(r: SessionDataset) -> dict:
    return {
        "dataset_id":           str(r.dataset_id),
        "session_id":           str(r.session_id),
        "created_at":           r.created_at.isoformat() if r.created_at else None,
        "closed_at":            r.closed_at.isoformat() if r.closed_at else None,
        "duration_seconds":     r.duration_seconds,
        "task_description":     r.task_description,
        "task_keywords":        r.task_keywords or [],
        "number_of_agents":     r.number_of_agents,
        "number_of_rounds_used": r.number_of_rounds_used,
        "number_of_polls":      r.number_of_polls,
        "number_of_polls_vetoed": r.number_of_polls_vetoed,
        "final_outcome":        r.final_outcome,
        "deliverable_format":   r.deliverable_format,
        "human_team_rating":    r.human_team_rating,
        "average_peer_rating":  r.average_peer_rating,
        "failure_reason":       r.failure_reason,
        "failure_free_text":    r.failure_free_text,
        "would_retry":          r.would_retry,
        "roles_present":        r.roles_present or [],
        "agent_slugs":          r.agent_slugs or [],
        "had_human_node":       r.had_human_node,
        "cluster_count":        r.cluster_count,
        "edge_count":           r.edge_count,
        "recorded_at":          r.recorded_at.isoformat() if r.recorded_at else None,
    }


def _serialize_agent_dataset(r: AgentDataset) -> dict:
    return {
        "agent_dataset_id":         str(r.agent_dataset_id),
        "session_id":               str(r.session_id),
        "agent_id":                 r.agent_id,
        "agent_slug":               r.agent_slug,
        "role":                     r.role,
        "messages_sent":            r.messages_sent,
        "messages_received":        r.messages_received,
        "rounds_participated":      r.rounds_participated,
        "peer_rating_received":     r.peer_rating_received,
        "human_rating_received":    r.human_rating_received,
        "final_reputation_score":   r.final_reputation_score,
        "response_time_avg_seconds": r.response_time_avg_seconds,
        "was_skipped":              r.was_skipped,
        "polls_proposed":           r.polls_proposed,
        "polls_voted":              r.polls_voted,
        "flagged_as_problem":       r.flagged_as_problem,
    }


def _serialize_feedback(r: SessionFeedback) -> dict:
    return {
        "feedback_id":           str(r.feedback_id),
        "session_id":            str(r.session_id),
        "failure_reason":        r.failure_reason.value,
        "failure_free_text":     r.failure_free_text,
        "problematic_agent_ids": r.problematic_agent_ids or [],
        "would_retry":           r.would_retry,
        "created_at":            r.created_at.isoformat() if r.created_at else None,
    }

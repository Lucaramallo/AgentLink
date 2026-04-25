"""Router de Reputación — feedback y cálculo de scores — Módulo 4."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.reputation import FeedbackRelational, FeedbackTechnical
from app.services.reputation import calculate_relational_reputation, calculate_technical_reputation

router = APIRouter(prefix="/reputation", tags=["reputation"])


# --- Schemas Pydantic ---

class FeedbackTechnicalCreate(BaseModel):
    room_id: uuid.UUID
    reviewer_agent_id: uuid.UUID
    reviewed_agent_id: uuid.UUID
    spec_compliance: float = Field(ge=1.0, le=5.0)
    communication_clarity: float = Field(ge=1.0, le=5.0)
    delivery_speed: float = Field(ge=1.0, le=5.0)
    comment: str


class FeedbackRelationalCreate(BaseModel):
    room_id: uuid.UUID
    reviewer_owner_id: uuid.UUID
    reviewed_agent_id: uuid.UUID
    would_hire_again: bool
    trust_level: float = Field(ge=1.0, le=5.0)
    coordination_quality: float = Field(ge=1.0, le=5.0)
    comment: str


class SessionAgent(BaseModel):
    id: str
    name: str
    role: str = "Contributor"


class SessionUpdateRequest(BaseModel):
    room_id: str
    agents: list[SessionAgent] = []
    peer_scores: dict[str, float] = {}
    human_scores: dict = {}
    session_stats: dict[str, int] = {}


# --- Endpoints ---

@router.post("/technical", status_code=status.HTTP_201_CREATED)
async def submit_technical_feedback(
    payload: FeedbackTechnicalCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """El Agente A deja feedback técnico sobre el Agente B al cerrar la sala."""
    feedback = FeedbackTechnical(**payload.model_dump())
    db.add(feedback)
    await db.flush()
    return {"feedback_id": str(feedback.feedback_id)}


@router.post("/relational", status_code=status.HTTP_201_CREATED)
async def submit_relational_feedback(
    payload: FeedbackRelationalCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """El dueño humano deja feedback relacional sobre un agente al cerrar la sala."""
    feedback = FeedbackRelational(**payload.model_dump())
    db.add(feedback)
    await db.flush()
    return {"feedback_id": str(feedback.feedback_id)}


@router.post("/session-update")
async def session_reputation_update(payload: SessionUpdateRequest) -> dict:
    """Compute final reputation scores for all agents after a session closes."""
    total_messages = sum(payload.session_stats.values()) or 1
    team_rating: float = payload.human_scores.get("team", 0)
    individual: dict[str, float] = payload.human_scores.get("individual", {})
    has_human = team_rating > 0

    peer_w = 0.35 if has_human else 0.55
    human_w = 0.30 if has_human else 0.0
    msg_w = 0.20
    role_w = 0.15

    _role_bonus = {
        "Builder": 1.15, "Reviewer": 1.10, "Requester": 1.05,
        "Contributor": 1.0, "Observer": 0.9,
    }

    results: dict[str, dict] = {}
    for agent in payload.agents:
        aid = agent.id
        peer_score = payload.peer_scores.get(aid, 3.0)

        if has_human:
            human_score = float(individual.get(aid, team_rating) or team_rating)
        else:
            human_score = 0.0

        msg_count = payload.session_stats.get(aid, 0)
        msg_score = (msg_count / total_messages) * 5.0

        bonus = _role_bonus.get(agent.role, 1.0)
        role_score = (bonus - 1.0) * 10.0 + 3.0

        final = (
            peer_score * peer_w
            + human_score * human_w
            + msg_score * msg_w
            + role_score * role_w
        )
        final = max(1.0, min(5.0, round(final, 2)))
        results[aid] = {
            "agent_name": agent.name,
            "final_score": final,
            "breakdown": {
                "peer_review": round(peer_score * peer_w, 2),
                "human_rating": round(human_score * human_w, 2),
                "messages_contributed": round(msg_score * msg_w, 2),
                "role_weight": round(role_score * role_w, 2),
            },
        }

    return {"room_id": payload.room_id, "reputation_updates": results}


@router.get("/agent/{agent_id}")
async def get_agent_reputation(
    agent_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Retorna las reputaciones técnica y relacional calculadas de un agente."""
    # Obtener los últimos 50 feedbacks técnicos
    tech_result = await db.execute(
        select(FeedbackTechnical)
        .where(FeedbackTechnical.reviewed_agent_id == agent_id)
        .order_by(FeedbackTechnical.submitted_at)
        .limit(50)
    )
    tech_feedbacks = [
        {
            "spec_compliance": fb.spec_compliance,
            "communication_clarity": fb.communication_clarity,
            "delivery_speed": fb.delivery_speed,
        }
        for fb in tech_result.scalars().all()
    ]

    # Obtener los últimos 50 feedbacks relacionales
    rel_result = await db.execute(
        select(FeedbackRelational)
        .where(FeedbackRelational.reviewed_agent_id == agent_id)
        .order_by(FeedbackRelational.submitted_at)
        .limit(50)
    )
    rel_feedbacks = [
        {
            "trust_level": fb.trust_level,
            "coordination_quality": fb.coordination_quality,
        }
        for fb in rel_result.scalars().all()
    ]

    return {
        "agent_id": str(agent_id),
        "reputation_technical": calculate_technical_reputation(tech_feedbacks),
        "reputation_relational": calculate_relational_reputation(rel_feedbacks),
        "label_technical": "Sin historial" if not tech_feedbacks else None,
        "label_relational": "Sin historial" if not rel_feedbacks else None,
    }

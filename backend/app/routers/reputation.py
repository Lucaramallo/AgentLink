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

"""Modelos de Reputación: FeedbackTechnical y FeedbackRelational — Módulo 4."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class FeedbackTechnical(Base):
    """Feedback dejado por el agente solicitante (A sobre B) al cerrar la sala."""

    __tablename__ = "feedback_technical"

    feedback_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.room_id"), nullable=False, index=True
    )
    reviewer_agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.agent_id"), nullable=False
    )
    reviewed_agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.agent_id"), nullable=False, index=True
    )

    # Scores 1.0 - 5.0
    spec_compliance: Mapped[float] = mapped_column(Float, nullable=False)
    communication_clarity: Mapped[float] = mapped_column(Float, nullable=False)
    delivery_speed: Mapped[float] = mapped_column(Float, nullable=False)

    comment: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FeedbackRelational(Base):
    """Feedback dejado por el dueño humano sobre confianza y coordinación."""

    __tablename__ = "feedback_relational"

    feedback_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.room_id"), nullable=False, index=True
    )
    reviewer_owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("human_owners.owner_id"), nullable=False
    )
    reviewed_agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.agent_id"), nullable=False, index=True
    )

    would_hire_again: Mapped[bool] = mapped_column(Boolean, nullable=False)

    # Scores 1.0 - 5.0
    trust_level: Mapped[float] = mapped_column(Float, nullable=False)
    coordination_quality: Mapped[float] = mapped_column(Float, nullable=False)

    comment: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

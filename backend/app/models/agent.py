"""Modelos de Identidad: Agent y HumanOwner — Módulo 1."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class HumanOwner(Base):
    """Cuenta humana verificada que posee y es responsable de uno o más agentes."""

    __tablename__ = "human_owners"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relación: un owner puede tener múltiples agentes
    agents: Mapped[list["Agent"]] = relationship("Agent", back_populates="owner")


class Agent(Base):
    """Agente de IA con identidad verificable registrado por un humano."""

    __tablename__ = "agents"

    agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    human_owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("human_owners.owner_id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    skills: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    framework: Mapped[str] = mapped_column(String(50), nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)

    # Reputación — nunca inicializar en 0, usar None para "Sin historial"
    reputation_technical: Mapped[float | None] = mapped_column(Float, nullable=True)
    reputation_relational: Mapped[float | None] = mapped_column(Float, nullable=True)

    total_jobs_completed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_jobs_disputed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relaciones
    owner: Mapped["HumanOwner"] = relationship("HumanOwner", back_populates="agents")

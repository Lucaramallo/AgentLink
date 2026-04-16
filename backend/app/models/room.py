"""Modelos de Sala de Colaboración: Room, RoomContract, Message — Módulo 2."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class RoomStatus(str, enum.Enum):
    OPEN = "OPEN"
    REVISION = "REVISION"
    DISPUTED = "DISPUTED"
    CLOSED = "CLOSED"
    ARCHIVED = "ARCHIVED"


class RoomOutcome(str, enum.Enum):
    SUCCESS = "SUCCESS"
    DISPUTE = "DISPUTE"
    TIMEOUT = "TIMEOUT"


class MessageType(str, enum.Enum):
    TASK = "TASK"
    DELIVERABLE = "DELIVERABLE"
    VERIFICATION = "VERIFICATION"
    REVISION_REQUEST = "REVISION_REQUEST"
    SYSTEM = "SYSTEM"


class RoomContract(Base):
    """Contrato firmado por ambos dueños antes de abrir la sala."""

    __tablename__ = "room_contracts"

    contract_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_description: Mapped[str] = mapped_column(Text, nullable=False)
    deliverable_spec: Mapped[str] = mapped_column(Text, nullable=False)
    max_revision_rounds: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    timeout_hours: Mapped[int] = mapped_column(Integer, default=48, nullable=False)
    owner_a_signed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    owner_b_signed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relación inversa
    room: Mapped["Room"] = relationship("Room", back_populates="contract", uselist=False)


class Room(Base):
    """Canal privado efímero entre dos agentes con protocolo de trabajo."""

    __tablename__ = "rooms"

    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    agent_a_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.agent_id"), nullable=False, index=True
    )
    agent_b_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.agent_id"), nullable=False, index=True
    )
    contract_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("room_contracts.contract_id"), nullable=False
    )
    status: Mapped[RoomStatus] = mapped_column(
        Enum(RoomStatus), default=RoomStatus.OPEN, nullable=False
    )
    revision_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome: Mapped[RoomOutcome | None] = mapped_column(Enum(RoomOutcome), nullable=True)

    # Relaciones
    contract: Mapped["RoomContract"] = relationship("RoomContract", back_populates="room")
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="room", order_by="Message.timestamp"
    )


class Message(Base):
    """Mensaje inmutable del log de sala — append-only, nunca editar ni borrar."""

    __tablename__ = "messages"

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.room_id"), nullable=False, index=True
    )
    sender_agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agents.agent_id"), nullable=False
    )
    content_natural: Mapped[str] = mapped_column(Text, nullable=False)
    content_structured: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    signature: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    message_type: Mapped[MessageType] = mapped_column(Enum(MessageType), nullable=False)

    # Relación
    room: Mapped["Room"] = relationship("Room", back_populates="messages")

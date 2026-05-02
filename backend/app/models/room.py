"""Modelos de Sala de Colaboración: Room, RoomContract, Message, Poll — Módulo 2."""

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
    INCOMPLETE = "INCOMPLETE"


class MessageType(str, enum.Enum):
    TASK = "TASK"
    DELIVERABLE = "DELIVERABLE"
    VERIFICATION = "VERIFICATION"
    REVISION_REQUEST = "REVISION_REQUEST"
    SYSTEM = "SYSTEM"
    POLL_EVENT = "POLL_EVENT"


class PollStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    VETOED = "VETOED"


class PollScope(str, enum.Enum):
    ALL = "ALL"
    CONTRIBUTORS_ONLY = "CONTRIBUTORS_ONLY"
    REVIEWERS_ONLY = "REVIEWERS_ONLY"


class PollActionType(str, enum.Enum):
    OPEN_ROUND = "OPEN_ROUND"
    SKIP_AGENT = "SKIP_AGENT"
    REASSIGN_BUILDER = "REASSIGN_BUILDER"
    CUSTOM_MESSAGE = "CUSTOM_MESSAGE"
    CONSENSUS = "CONSENSUS"


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
    # Immutable snapshot of each agent's config at contract creation time.
    # Keys: "agent_a" and "agent_b", each holding fields from the Agent model.
    agent_snapshots: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=None)

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
    # Agent UUIDs (as strings) removed mid-session due to webhook failure.
    dropped_agents: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=None)
    # Optional: user's GitHub repo URL to push deliverable into (Mode A delivery).
    github_repo_url: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    # Resulting GitHub branch URL after deliver-github is called.
    github_delivery_url: Mapped[str | None] = mapped_column(String(1000), nullable=True, default=None)
    # Full agent/edge graph for turn order. Set once when the session opens.
    session_graph: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=None)
    # Seconds an agent may stay in THINKING before being marked SKIPPED.
    thinking_timeout_secs: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    # Coordinator-generated task plan: {"assignments": [{agent_id, agent_name, subtask}...], "summary": "..."}
    coordinator_plan: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=None)

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


class Poll(Base):
    """Poll propuesto por un agente o humano durante una sesión — inmutable tras cierre."""

    __tablename__ = "polls"

    poll_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.room_id"), nullable=False, index=True
    )
    # UUID string of the proposing agent, or "human" for the session's human user
    proposed_by: Mapped[str] = mapped_column(String(64), nullable=False)
    proposed_by_type: Mapped[str] = mapped_column(String(16), nullable=False)  # "agent" | "human"
    question: Mapped[str] = mapped_column(Text, nullable=False)
    # list[str] — 2 to 4 options
    options: Mapped[list] = mapped_column(JSONB, nullable=False)
    # list[{voter_id, voter_type, option_index, weight}] — append-only
    votes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[PollStatus] = mapped_column(
        Enum(PollStatus), default=PollStatus.OPEN, nullable=False
    )
    scope: Mapped[PollScope] = mapped_column(
        Enum(PollScope), default=PollScope.ALL, nullable=False
    )
    deadline_secs: Mapped[int] = mapped_column(Integer, default=120, nullable=False)
    action_type: Mapped[PollActionType | None] = mapped_column(
        Enum(PollActionType), nullable=True
    )
    # Extra params for the action, e.g. {"agent_id": "..."} for SKIP_AGENT
    action_params: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=None)
    # {winning_option_index, winning_label, weighted_totals: [float], action_applied: bool}
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # ed25519 signature over canonical_poll_string()
    signature: Mapped[str] = mapped_column(Text, nullable=False)

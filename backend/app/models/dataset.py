"""Dataset models — proprietary collaborative behavior dataset."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class FailureReason(str, enum.Enum):
    AGENT_DID_NOT_UNDERSTAND = "AGENT_DID_NOT_UNDERSTAND"
    AGENT_QUALITY_TOO_LOW    = "AGENT_QUALITY_TOO_LOW"
    SESSION_TOO_LONG         = "SESSION_TOO_LONG"
    TECHNICAL_FAILURE        = "TECHNICAL_FAILURE"
    TASK_TOO_COMPLEX         = "TASK_TOO_COMPLEX"
    REQUESTER_CHANGED_MIND   = "REQUESTER_CHANGED_MIND"
    OTHER                    = "OTHER"


class SessionFeedback(Base):
    """Mandatory failure feedback collected for non-CONFORME sessions."""

    __tablename__ = "session_feedback"

    feedback_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.room_id"), nullable=False, index=True, unique=True
    )
    failure_reason: Mapped[FailureReason] = mapped_column(
        Enum(FailureReason), nullable=False
    )
    failure_free_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional list of agent UUID strings identified as problematic
    problematic_agent_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=None)
    would_retry: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SessionDataset(Base):
    """Session-level performance snapshot — one row per terminal session."""

    __tablename__ = "session_dataset"
    __table_args__ = (UniqueConstraint("session_id", name="uq_session_dataset_session"),)

    dataset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.room_id"), nullable=False, index=True
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    task_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # list[str] — up to 10 topic tags extracted via Claude API
    task_keywords: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=None)
    number_of_agents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    number_of_rounds_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    number_of_polls: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    number_of_polls_vetoed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # CONFORME | NO_CONFORME | CANCELLED | INCOMPLETE | DISPUTED
    final_outcome: Mapped[str] = mapped_column(String(32), nullable=False)
    deliverable_format: Mapped[str | None] = mapped_column(String(16), nullable=True)
    human_team_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_peer_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Denormalized from SessionFeedback for query convenience
    failure_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    failure_free_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    would_retry: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Structural graph data
    roles_present: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=None)
    agent_slugs: Mapped[list | None] = mapped_column(JSONB, nullable=True, default=None)
    had_human_node: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    cluster_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    edge_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    coordinator_had_plan: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    coordinator_plan_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AgentDataset(Base):
    """Per-agent performance metrics for one session — one row per agent per session."""

    __tablename__ = "agent_dataset"

    agent_dataset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.room_id"), nullable=False, index=True
    )
    agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    agent_slug: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(64), nullable=False)
    messages_sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    messages_received: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rounds_participated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    peer_rating_received: Mapped[float | None] = mapped_column(Float, nullable=True)
    human_rating_received: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_reputation_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Not yet capturable from current data — reserved for future instrumentation
    response_time_avg_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    was_skipped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    polls_proposed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    polls_voted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    flagged_as_problem: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

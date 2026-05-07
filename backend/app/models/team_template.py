"""TeamTemplate — saved canvas configuration (agents + edges + clusters)."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class TeamTemplate(Base):
    """A saved team configuration that can be reloaded in the session builder."""

    __tablename__ = "team_templates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    # List of {slug, role, cluster_id?}
    agents: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # List of {from, to}
    edges: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # List of cluster objects
    clusters: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

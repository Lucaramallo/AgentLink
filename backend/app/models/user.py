"""Modelo User — cuenta humana con autenticación JWT."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class UserRole(str, enum.Enum):
    USER = "USER"
    SUPERADMIN = "SUPERADMIN"


class User(Base):
    """Cuenta humana registrada con email/password y perfil completo."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    nationality: Mapped[str] = mapped_column(String(100), nullable=False)
    github_username: Mapped[str | None] = mapped_column(String(100), nullable=True)
    github_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    github_access_token: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole), nullable=False, default=UserRole.USER
    )
    alc_balance: Mapped[float] = mapped_column(Float, nullable=False, default=1000.0)
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    agents: Mapped[list["Agent"]] = relationship(  # type: ignore[name-defined]
        "Agent", back_populates="user", foreign_keys="Agent.user_id"
    )

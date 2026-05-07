"""add team_templates table

Revision ID: m3h4i5j6k7l8
Revises: l2g3h4i5j6k7
Create Date: 2026-05-07 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "m3h4i5j6k7l8"
down_revision: str | None = "l2g3h4i5j6k7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "team_templates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("agents", JSONB, nullable=False, server_default="[]"),
        sa.Column("edges", JSONB, nullable=False, server_default="[]"),
        sa.Column("clusters", JSONB, nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_team_templates_user_id", "team_templates", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_team_templates_user_id", table_name="team_templates")
    op.drop_table("team_templates")

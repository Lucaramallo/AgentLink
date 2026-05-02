"""Add polls table and POLL_EVENT message type

Revision ID: j0e1f2a3b4c5
Revises: i9d0e1f2a3b4
Create Date: 2026-05-02

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID

revision = "j0e1f2a3b4c5"
down_revision = "i9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Extend the messagetype enum before creating the table that uses it
    op.execute("ALTER TYPE messagetype ADD VALUE IF NOT EXISTS 'POLL_EVENT'")

    op.execute(
        "CREATE TYPE pollstatus AS ENUM ('OPEN', 'CLOSED', 'VETOED')"
    )
    op.execute(
        "CREATE TYPE pollscope AS ENUM ('ALL', 'CONTRIBUTORS_ONLY', 'REVIEWERS_ONLY')"
    )
    op.execute(
        "CREATE TYPE pollactiontype AS ENUM "
        "('OPEN_ROUND', 'SKIP_AGENT', 'REASSIGN_BUILDER', 'CUSTOM_MESSAGE', 'CONSENSUS')"
    )

    op.create_table(
        "polls",
        sa.Column("poll_id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "room_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("rooms.room_id"),
            nullable=False,
            index=True,
        ),
        sa.Column("proposed_by", sa.String(64), nullable=False),
        sa.Column("proposed_by_type", sa.String(16), nullable=False),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("options", JSONB, nullable=False),
        sa.Column("votes", JSONB, nullable=False, server_default="'[]'::jsonb"),
        sa.Column(
            "status",
            sa.Enum("OPEN", "CLOSED", "VETOED", name="pollstatus", create_type=False),
            nullable=False,
            server_default="OPEN",
        ),
        sa.Column(
            "scope",
            sa.Enum(
                "ALL", "CONTRIBUTORS_ONLY", "REVIEWERS_ONLY",
                name="pollscope", create_type=False,
            ),
            nullable=False,
            server_default="ALL",
        ),
        sa.Column("deadline_secs", sa.Integer, nullable=False, server_default="120"),
        sa.Column(
            "action_type",
            sa.Enum(
                "OPEN_ROUND", "SKIP_AGENT", "REASSIGN_BUILDER", "CUSTOM_MESSAGE", "CONSENSUS",
                name="pollactiontype", create_type=False,
            ),
            nullable=True,
        ),
        sa.Column("action_params", JSONB, nullable=True),
        sa.Column("result", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("signature", sa.Text, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("polls")
    op.execute("DROP TYPE IF EXISTS pollactiontype")
    op.execute("DROP TYPE IF EXISTS pollscope")
    op.execute("DROP TYPE IF EXISTS pollstatus")
    # NOTE: removing a value from a PostgreSQL enum requires recreating it —
    # we intentionally leave POLL_EVENT in messagetype on downgrade.

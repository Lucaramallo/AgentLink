"""Add polls table and POLL_EVENT message type

Revision ID: j0e1f2a3b4c5
Revises: i9d0e1f2a3b4
Create Date: 2026-05-02

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID, ENUM as PGEnum

revision = "j0e1f2a3b4c5"
down_revision = "i9d0e1f2a3b4"
branch_labels = None
depends_on = None

pollstatus = PGEnum("OPEN", "CLOSED", "VETOED", name="pollstatus")
pollscope = PGEnum("ALL", "CONTRIBUTORS_ONLY", "REVIEWERS_ONLY", name="pollscope")
pollactiontype = PGEnum(
    "OPEN_ROUND", "SKIP_AGENT", "REASSIGN_BUILDER", "CUSTOM_MESSAGE", "CONSENSUS",
    name="pollactiontype",
)


def upgrade() -> None:
    op.execute("ALTER TYPE messagetype ADD VALUE IF NOT EXISTS 'POLL_EVENT'")

    bind = op.get_bind()
    pollstatus.create(bind, checkfirst=True)
    pollscope.create(bind, checkfirst=True)
    pollactiontype.create(bind, checkfirst=True)

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
        sa.Column("votes", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "status",
            PGEnum("OPEN", "CLOSED", "VETOED", name="pollstatus", create_type=False),
            nullable=False,
            server_default="OPEN",
        ),
        sa.Column(
            "scope",
            PGEnum(
                "ALL", "CONTRIBUTORS_ONLY", "REVIEWERS_ONLY",
                name="pollscope", create_type=False,
            ),
            nullable=False,
            server_default="ALL",
        ),
        sa.Column("deadline_secs", sa.Integer, nullable=False, server_default="120"),
        sa.Column(
            "action_type",
            PGEnum(
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
    pollactiontype.drop(op.get_bind(), checkfirst=True)
    pollscope.drop(op.get_bind(), checkfirst=True)
    pollstatus.drop(op.get_bind(), checkfirst=True)
    # NOTE: removing a value from a PostgreSQL enum requires recreating it —
    # we intentionally leave POLL_EVENT in messagetype on downgrade.

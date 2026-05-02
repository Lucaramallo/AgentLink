"""Add session_graph and thinking_timeout_secs to rooms

Revision ID: i9d0e1f2a3b4
Revises: h8c9d0e1f2a3
Create Date: 2026-05-02

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "i9d0e1f2a3b4"
down_revision = "h8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rooms", sa.Column("session_graph", JSONB(), nullable=True))
    op.add_column(
        "rooms",
        sa.Column(
            "thinking_timeout_secs",
            sa.Integer(),
            nullable=False,
            server_default="60",
        ),
    )


def downgrade() -> None:
    op.drop_column("rooms", "thinking_timeout_secs")
    op.drop_column("rooms", "session_graph")

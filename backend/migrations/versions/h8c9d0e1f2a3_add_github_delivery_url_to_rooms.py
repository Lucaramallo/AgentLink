"""Add github_delivery_url to rooms

Revision ID: h8c9d0e1f2a3
Revises: g7b8c9d0e1f2
Create Date: 2026-05-02

"""

from alembic import op
import sqlalchemy as sa

revision = "h8c9d0e1f2a3"
down_revision = "g7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("github_delivery_url", sa.String(1000), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "github_delivery_url")

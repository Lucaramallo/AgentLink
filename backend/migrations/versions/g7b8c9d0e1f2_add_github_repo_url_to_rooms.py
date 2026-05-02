"""Add github_repo_url to rooms

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-05-02

"""

from alembic import op
import sqlalchemy as sa

revision = "g7b8c9d0e1f2"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rooms",
        sa.Column("github_repo_url", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rooms", "github_repo_url")

"""add agent pricing and webhook fields

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('agents', sa.Column('session_fee', sa.Float(), nullable=True))
    op.add_column('agents', sa.Column('cost_per_message', sa.Float(), nullable=True))
    op.add_column('agents', sa.Column('github_repo_url', sa.String(500), nullable=True))
    op.add_column('agents', sa.Column('webhook_url', sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column('agents', 'webhook_url')
    op.drop_column('agents', 'github_repo_url')
    op.drop_column('agents', 'cost_per_message')
    op.drop_column('agents', 'session_fee')

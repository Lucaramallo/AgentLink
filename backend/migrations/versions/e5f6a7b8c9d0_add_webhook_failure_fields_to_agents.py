"""add webhook failure fields to agents

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('agents', sa.Column('last_webhook_failure', sa.DateTime(timezone=True), nullable=True))
    op.add_column('agents', sa.Column('webhook_failures_count', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('agents', 'webhook_failures_count')
    op.drop_column('agents', 'last_webhook_failure')

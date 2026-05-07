"""add dropped_agents to rooms and INCOMPLETE to roomoutcome

Revision ID: b7c8d9e0f1a2
Revises: f6a7b8c9d0e1
Create Date: 2026-04-30 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS dropped_agents JSONB")
    op.execute("ALTER TYPE roomoutcome ADD VALUE IF NOT EXISTS 'INCOMPLETE'")


def downgrade() -> None:
    op.drop_column('rooms', 'dropped_agents')
    # Note: PostgreSQL does not support removing enum values without recreating the type

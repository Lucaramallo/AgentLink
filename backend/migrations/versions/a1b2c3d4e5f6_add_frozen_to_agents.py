"""add frozen to agents

Revision ID: a1b2c3d4e5f6
Revises: 6bcae615d797
Create Date: 2026-04-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '6bcae615d797'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('agents', sa.Column('frozen', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('agents', 'frozen')

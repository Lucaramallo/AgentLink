"""add repo_tree, repo_branch, repo_branch_strategy to rooms

Revision ID: o5j6k7l8m9n0
Revises: b2c3d4e5f6a7
Create Date: 2026-05-19 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'o5j6k7l8m9n0'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rooms', sa.Column('repo_tree', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('rooms', sa.Column('repo_branch', sa.String(length=200), nullable=True))
    op.add_column('rooms', sa.Column('repo_branch_strategy', sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column('rooms', 'repo_branch_strategy')
    op.drop_column('rooms', 'repo_branch')
    op.drop_column('rooms', 'repo_tree')

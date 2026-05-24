"""add continue_from_room_id to rooms

Revision ID: q7l8m9n0o1p2
Revises: p6k7l8m9n0o1
Create Date: 2026-05-24 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'q7l8m9n0o1p2'
down_revision: Union[str, None] = 'p6k7l8m9n0o1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rooms', sa.Column(
        'continue_from_room_id',
        postgresql.UUID(as_uuid=True),
        nullable=True,
    ))


def downgrade() -> None:
    op.drop_column('rooms', 'continue_from_room_id')

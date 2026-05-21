"""add requester_user_id and escrowed_alc to rooms

Revision ID: p6k7l8m9n0o1
Revises: 841027d44557
Create Date: 2026-05-21 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'p6k7l8m9n0o1'
down_revision: Union[str, None] = '841027d44557'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rooms', sa.Column(
        'requester_user_id',
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey('users.id'),
        nullable=True,
    ))
    op.add_column('rooms', sa.Column(
        'escrowed_alc',
        sa.Float(),
        nullable=False,
        server_default='0.0',
    ))


def downgrade() -> None:
    op.drop_column('rooms', 'escrowed_alc')
    op.drop_column('rooms', 'requester_user_id')

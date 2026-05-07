"""merge_heads

Revision ID: 72dea6cad261
Revises: b7c8d9e0f1a2, l2g3h4i5j6k7
Create Date: 2026-05-07 09:36:47.173037

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '72dea6cad261'
down_revision: Union[str, None] = ('b7c8d9e0f1a2', 'l2g3h4i5j6k7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

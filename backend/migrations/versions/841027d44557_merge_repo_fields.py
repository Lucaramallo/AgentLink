"""merge_repo_fields

Revision ID: 841027d44557
Revises: n4i5j6k7l8m9, o5j6k7l8m9n0
Create Date: 2026-05-19 23:43:01.976009

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '841027d44557'
down_revision: Union[str, None] = ('n4i5j6k7l8m9', 'o5j6k7l8m9n0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

"""merge_team_templates

Revision ID: afade07661ec
Revises: 72dea6cad261, m3h4i5j6k7l8
Create Date: 2026-05-08 13:04:03.826726

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'afade07661ec'
down_revision: Union[str, None] = ('72dea6cad261', 'm3h4i5j6k7l8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

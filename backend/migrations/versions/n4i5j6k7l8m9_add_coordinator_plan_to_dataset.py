"""add coordinator_had_plan and coordinator_plan_summary to session_dataset

Revision ID: n4i5j6k7l8m9
Revises: afade07661ec
Create Date: 2026-05-08 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "n4i5j6k7l8m9"
down_revision: Union[str, None] = "afade07661ec"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_dataset",
        sa.Column("coordinator_had_plan", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "session_dataset",
        sa.Column("coordinator_plan_summary", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_dataset", "coordinator_plan_summary")
    op.drop_column("session_dataset", "coordinator_had_plan")

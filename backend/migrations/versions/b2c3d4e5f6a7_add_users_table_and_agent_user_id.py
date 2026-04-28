"""add users table and agent user_id

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-28 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('full_name', sa.String(length=255), nullable=False),
        sa.Column('nationality', sa.String(length=100), nullable=False),
        sa.Column('github_username', sa.String(length=100), nullable=True),
        sa.Column('github_url', sa.String(length=500), nullable=True),
        sa.Column(
            'role',
            sa.Enum('USER', 'SUPERADMIN', name='userrole'),
            nullable=False,
            server_default='USER',
        ),
        sa.Column('alc_balance', sa.Float(), nullable=False, server_default='1000.0'),
        sa.Column('is_verified', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)

    op.add_column(
        'agents',
        sa.Column('user_id', sa.UUID(), nullable=True),
    )
    op.create_index(op.f('ix_agents_user_id'), 'agents', ['user_id'], unique=False)
    op.create_foreign_key(
        'fk_agents_user_id_users',
        'agents', 'users',
        ['user_id'], ['id'],
    )


def downgrade() -> None:
    op.drop_constraint('fk_agents_user_id_users', 'agents', type_='foreignkey')
    op.drop_index(op.f('ix_agents_user_id'), table_name='agents')
    op.drop_column('agents', 'user_id')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.execute("DROP TYPE IF EXISTS userrole")

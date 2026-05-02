"""Add dataset tables: session_feedback, session_dataset, agent_dataset

Revision ID: k1f2a3b4c5d6
Revises: j0e1f2a3b4c5
Create Date: 2026-05-02

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID

revision = "k1f2a3b4c5d6"
down_revision = "j0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE failurereason AS ENUM ("
        "'AGENT_DID_NOT_UNDERSTAND', 'AGENT_QUALITY_TOO_LOW', 'SESSION_TOO_LONG', "
        "'TECHNICAL_FAILURE', 'TASK_TOO_COMPLEX', 'REQUESTER_CHANGED_MIND', 'OTHER')"
    )

    op.create_table(
        "session_feedback",
        sa.Column("feedback_id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("rooms.room_id"),
            nullable=False,
            index=True,
            unique=True,
        ),
        sa.Column(
            "failure_reason",
            sa.Enum(
                "AGENT_DID_NOT_UNDERSTAND", "AGENT_QUALITY_TOO_LOW", "SESSION_TOO_LONG",
                "TECHNICAL_FAILURE", "TASK_TOO_COMPLEX", "REQUESTER_CHANGED_MIND", "OTHER",
                name="failurereason", create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("failure_free_text", sa.Text, nullable=False),
        sa.Column("problematic_agent_ids", JSONB, nullable=True),
        sa.Column("would_retry", sa.Boolean, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_table(
        "session_dataset",
        sa.Column("dataset_id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("rooms.room_id"),
            nullable=False,
            index=True,
            unique=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer, nullable=True),
        sa.Column("task_description", sa.Text, nullable=True),
        sa.Column("task_keywords", JSONB, nullable=True),
        sa.Column("number_of_agents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("number_of_rounds_used", sa.Integer, nullable=False, server_default="0"),
        sa.Column("number_of_polls", sa.Integer, nullable=False, server_default="0"),
        sa.Column("number_of_polls_vetoed", sa.Integer, nullable=False, server_default="0"),
        sa.Column("final_outcome", sa.String(32), nullable=False),
        sa.Column("deliverable_format", sa.String(16), nullable=True),
        sa.Column("human_team_rating", sa.Float, nullable=True),
        sa.Column("average_peer_rating", sa.Float, nullable=True),
        sa.Column("failure_reason", sa.String(64), nullable=True),
        sa.Column("failure_free_text", sa.Text, nullable=True),
        sa.Column("would_retry", sa.Boolean, nullable=True),
        sa.Column("roles_present", JSONB, nullable=True),
        sa.Column("agent_slugs", JSONB, nullable=True),
        sa.Column("had_human_node", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("cluster_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("edge_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_table(
        "agent_dataset",
        sa.Column("agent_dataset_id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("rooms.room_id"),
            nullable=False,
            index=True,
        ),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("agent_slug", sa.String(128), nullable=False),
        sa.Column("role", sa.String(64), nullable=False),
        sa.Column("messages_sent", sa.Integer, nullable=False, server_default="0"),
        sa.Column("messages_received", sa.Integer, nullable=False, server_default="0"),
        sa.Column("rounds_participated", sa.Integer, nullable=False, server_default="0"),
        sa.Column("peer_rating_received", sa.Float, nullable=True),
        sa.Column("human_rating_received", sa.Float, nullable=True),
        sa.Column("final_reputation_score", sa.Float, nullable=True),
        sa.Column("response_time_avg_seconds", sa.Float, nullable=True),
        sa.Column("was_skipped", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("polls_proposed", sa.Integer, nullable=False, server_default="0"),
        sa.Column("polls_voted", sa.Integer, nullable=False, server_default="0"),
        sa.Column("flagged_as_problem", sa.Boolean, nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_table("agent_dataset")
    op.drop_table("session_dataset")
    op.drop_table("session_feedback")
    op.execute("DROP TYPE IF EXISTS failurereason")

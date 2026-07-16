"""add authenticated sessions and persistent feedback moderation

Revision ID: 0008_privacy_feedback
Revises: 0007_content_page_timings
Create Date: 2026-07-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0008_privacy_feedback"
down_revision = "0007_content_page_timings"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("learner_id", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["learner_id"], ["learners.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_auth_sessions_id"), "auth_sessions", ["id"], unique=False)
    op.create_index(op.f("ix_auth_sessions_learner_id"), "auth_sessions", ["learner_id"], unique=False)
    op.create_index(op.f("ix_auth_sessions_token_hash"), "auth_sessions", ["token_hash"], unique=True)

    op.create_table(
        "peer_feedback",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("feedback_id", sa.String(length=128), nullable=False),
        sa.Column("learner_id", sa.Integer(), nullable=False),
        sa.Column("lesson_id", sa.String(length=128), nullable=True),
        sa.Column("topic", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("clarity", sa.Integer(), nullable=False),
        sa.Column("accessibility", sa.Integer(), nullable=False),
        sa.Column("modality_fit", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("inappropriate", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("moderation_flags", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["learner_id"], ["learners.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_peer_feedback_feedback_id"), "peer_feedback", ["feedback_id"], unique=True)
    op.create_index(op.f("ix_peer_feedback_id"), "peer_feedback", ["id"], unique=False)
    op.create_index(op.f("ix_peer_feedback_learner_id"), "peer_feedback", ["learner_id"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_peer_feedback_learner_id"), table_name="peer_feedback")
    op.drop_index(op.f("ix_peer_feedback_id"), table_name="peer_feedback")
    op.drop_index(op.f("ix_peer_feedback_feedback_id"), table_name="peer_feedback")
    op.drop_table("peer_feedback")
    op.drop_index(op.f("ix_auth_sessions_token_hash"), table_name="auth_sessions")
    op.drop_index(op.f("ix_auth_sessions_learner_id"), table_name="auth_sessions")
    op.drop_index(op.f("ix_auth_sessions_id"), table_name="auth_sessions")
    op.drop_table("auth_sessions")

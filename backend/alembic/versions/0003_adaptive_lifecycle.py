"""adaptive lifecycle

Revision ID: 0003_adaptive_lifecycle
Revises: 0002_curriculum_progress
Create Date: 2026-05-31 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0003_adaptive_lifecycle"
down_revision = "0002_curriculum_progress"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("learners", sa.Column("full_name", sa.String(length=160), nullable=True))
    op.add_column("learners", sa.Column("email", sa.String(length=320), nullable=True))
    op.add_column("learners", sa.Column("password_hash", sa.String(length=512), nullable=True))
    op.add_column("learners", sa.Column("age", sa.Integer(), nullable=True))
    op.add_column("learners", sa.Column("onboarding_status", sa.String(length=64), nullable=False, server_default="profile_pending"))
    op.add_column("learners", sa.Column("learning_availability", sa.String(length=64), nullable=True))
    op.add_column("learners", sa.Column("learning_project", sa.String(length=512), nullable=True))
    op.add_column("learners", sa.Column("learner_model", sa.JSON(), nullable=True))
    op.create_index("ix_learners_email", "learners", ["email"], unique=True)

    op.create_table(
        "interactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("interaction_id", sa.String(length=128), nullable=False),
        sa.Column("learner_id", sa.Integer(), sa.ForeignKey("learners.id"), nullable=False),
        sa.Column("session_id", sa.String(length=128), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("request", sa.JSON(), nullable=True),
        sa.Column("response", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_interactions_interaction_id", "interactions", ["interaction_id"], unique=True)

    op.create_table(
        "quizzes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("quiz_id", sa.String(length=128), nullable=False),
        sa.Column("learner_id", sa.Integer(), sa.ForeignKey("learners.id"), nullable=False),
        sa.Column("session_id", sa.String(length=128), nullable=False),
        sa.Column("topic", sa.String(length=128), nullable=True),
        sa.Column("questions", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_quizzes_quiz_id", "quizzes", ["quiz_id"], unique=True)


def downgrade():
    op.drop_index("ix_quizzes_quiz_id", table_name="quizzes")
    op.drop_table("quizzes")
    op.drop_index("ix_interactions_interaction_id", table_name="interactions")
    op.drop_table("interactions")
    op.drop_index("ix_learners_email", table_name="learners")
    op.drop_column("learners", "learner_model")
    op.drop_column("learners", "learning_availability")
    op.drop_column("learners", "learning_project")
    op.drop_column("learners", "onboarding_status")
    op.drop_column("learners", "password_hash")
    op.drop_column("learners", "age")
    op.drop_column("learners", "email")
    op.drop_column("learners", "full_name")

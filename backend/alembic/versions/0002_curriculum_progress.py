"""curriculum progress

Revision ID: 0002_curriculum_progress
Revises: 0001_initial
Create Date: 2026-05-25 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0002_curriculum_progress"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "curriculum_progress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("learner_id", sa.Integer(), sa.ForeignKey("learners.id"), nullable=False),
        sa.Column("curriculum_item_id", sa.String(length=128), nullable=False),
        sa.Column("topic", sa.String(length=128), nullable=True),
        sa.Column("concept", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("mastery_score", sa.Float(), nullable=False),
        sa.Column("progress_metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("learner_id", "curriculum_item_id", name="uq_curriculum_progress_learner_item"),
    )


def downgrade():
    op.drop_table("curriculum_progress")

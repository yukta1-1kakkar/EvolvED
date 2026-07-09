"""published content completions

Revision ID: 0005_content_completions
Revises: 0004_classroom_rbac
Create Date: 2026-07-09 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_content_completions"
down_revision = "0004_classroom_rbac"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "content_completions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("learner_id", sa.Integer(), sa.ForeignKey("learners.id"), nullable=False),
        sa.Column("draft_id", sa.Integer(), sa.ForeignKey("content_drafts.id"), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("score", sa.Float(), nullable=False, server_default="1"),
        sa.Column("evaluation", sa.Text(), nullable=False, server_default=""),
        sa.Column("completed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("learner_id", "draft_id", name="uq_content_completion_learner_draft"),
    )
    op.create_index("ix_content_completions_id", "content_completions", ["id"])


def downgrade():
    op.drop_index("ix_content_completions_id", table_name="content_completions")
    op.drop_table("content_completions")

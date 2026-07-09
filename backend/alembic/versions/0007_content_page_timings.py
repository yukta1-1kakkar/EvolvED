"""store per-page timing for published content

Revision ID: 0007_content_page_timings
Revises: 0006_scope_published_content
Create Date: 2026-07-09 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0007_content_page_timings"
down_revision = "0006_scope_published_content"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "content_page_timings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("learner_id", sa.Integer(), nullable=False),
        sa.Column("draft_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("page_key", sa.String(length=128), nullable=False),
        sa.Column("page_title", sa.String(length=256), nullable=True),
        sa.Column("seconds_spent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("visit_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["draft_id"], ["content_drafts.id"]),
        sa.ForeignKeyConstraint(["learner_id"], ["learners.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("learner_id", "draft_id", "page_key", name="uq_content_page_timing_learner_draft_page"),
    )
    op.create_index(op.f("ix_content_page_timings_id"), "content_page_timings", ["id"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_content_page_timings_id"), table_name="content_page_timings")
    op.drop_table("content_page_timings")

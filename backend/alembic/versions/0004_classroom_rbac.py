"""classroom rbac foundation

Revision ID: 0004_classroom_rbac
Revises: 0003_adaptive_lifecycle
Create Date: 2026-07-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0004_classroom_rbac"
down_revision = "0003_adaptive_lifecycle"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("learners", sa.Column("role", sa.String(length=32), nullable=False, server_default="student"))

    op.create_table(
        "learning_modules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("module_id", sa.String(length=128), nullable=False),
        sa.Column("leader_id", sa.Integer(), sa.ForeignKey("learners.id"), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("active", sa.Boolean(), nullable=True),
    )
    op.create_index("ix_learning_modules_module_id", "learning_modules", ["module_id"], unique=True)

    op.create_table(
        "class_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("class_id", sa.String(length=128), nullable=False),
        sa.Column("module_id", sa.Integer(), sa.ForeignKey("learning_modules.id"), nullable=True),
        sa.Column("leader_id", sa.Integer(), sa.ForeignKey("learners.id"), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("join_code", sa.String(length=32), nullable=False),
        sa.Column("invite_link", sa.String(length=512), nullable=False),
        sa.Column("max_students", sa.Integer(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_class_groups_class_id", "class_groups", ["class_id"], unique=True)
    op.create_index("ix_class_groups_join_code", "class_groups", ["join_code"], unique=True)

    op.create_table(
        "enrollments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class_groups.id"), nullable=False),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("learners.id"), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("class_id", "student_id", name="uq_enrollment_class_student"),
    )

    op.create_table(
        "content_drafts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("draft_id", sa.String(length=128), nullable=False),
        sa.Column("leader_id", sa.Integer(), sa.ForeignKey("learners.id"), nullable=False),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class_groups.id"), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("source_material", sa.JSON(), nullable=True),
        sa.Column("generated_content", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("approval", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_content_drafts_draft_id", "content_drafts", ["draft_id"], unique=True)


def downgrade():
    op.drop_index("ix_content_drafts_draft_id", table_name="content_drafts")
    op.drop_table("content_drafts")
    op.drop_table("enrollments")
    op.drop_index("ix_class_groups_join_code", table_name="class_groups")
    op.drop_index("ix_class_groups_class_id", table_name="class_groups")
    op.drop_table("class_groups")
    op.drop_index("ix_learning_modules_module_id", table_name="learning_modules")
    op.drop_table("learning_modules")
    op.drop_column("learners", "role")

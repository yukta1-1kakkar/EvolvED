"""scope existing published content to a classroom

Revision ID: 0006_scope_published_content
Revises: 0005_content_completions
Create Date: 2026-07-09 00:00:00.000000
"""
from alembic import op


revision = "0006_scope_published_content"
down_revision = "0005_content_completions"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        UPDATE content_drafts AS draft
        SET class_id = (
            SELECT class_group.id
            FROM class_groups AS class_group
            WHERE class_group.leader_id = draft.leader_id
              AND class_group.active = true
            ORDER BY class_group.created_at, class_group.id
            LIMIT 1
        )
        WHERE draft.class_id IS NULL
          AND draft.status = 'accepted'
          AND EXISTS (
            SELECT 1
            FROM class_groups AS class_group
            WHERE class_group.leader_id = draft.leader_id
              AND class_group.active = true
          )
        """
    )


def downgrade():
    pass

"""persist feedback alert dismissal

Revision ID: 0009_feedback_dismissal
Revises: 0008_privacy_feedback
Create Date: 2026-07-17 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0009_feedback_dismissal"
down_revision = "0008_privacy_feedback"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("peer_feedback", sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("peer_feedback", "dismissed_at")

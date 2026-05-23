"""initial

Revision ID: 0001_initial
Revises: 
Create Date: 2026-05-23 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'learners',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('learner_id', sa.String(length=128), nullable=False),
        sa.Column('age_group', sa.String(length=64)),
        sa.Column('education_level', sa.String(length=128)),
        sa.Column('learning_goal', sa.String(length=256)),
        sa.Column('pace_preference', sa.String(length=64)),
        sa.Column('preferred_modality', sa.JSON(), nullable=True),
        sa.Column('topic', sa.String(length=128)),
        sa.Column('topic_familiarity', sa.String(length=64)),
        sa.Column('accessibility', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'sessions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('session_id', sa.String(length=128), nullable=False),
        sa.Column('learner_id', sa.Integer(), sa.ForeignKey('learners.id'), nullable=False),
        sa.Column('state', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'assessments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('learner_id', sa.Integer(), sa.ForeignKey('learners.id'), nullable=False),
        sa.Column('session_id', sa.String(length=128), nullable=True),
        sa.Column('submission', sa.JSON(), nullable=True),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'adaptations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('learner_id', sa.Integer(), sa.ForeignKey('learners.id'), nullable=False),
        sa.Column('session_id', sa.String(length=128), nullable=True),
        sa.Column('decision', sa.JSON(), nullable=True),
        sa.Column('applied', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        'strategy_history',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('learner_id', sa.Integer(), sa.ForeignKey('learners.id'), nullable=True),
        sa.Column('strategy', sa.JSON(), nullable=True),
        sa.Column('effectiveness', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('strategy_history')
    op.drop_table('adaptations')
    op.drop_table('assessments')
    op.drop_table('sessions')
    op.drop_table('learners')

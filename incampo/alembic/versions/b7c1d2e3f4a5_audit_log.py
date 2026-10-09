"""audit_log

Revision ID: b7c1d2e3f4a5
Revises: f14c50457629
Create Date: 2026-09-17 18:10:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b7c1d2e3f4a5'
down_revision: Union[str, Sequence[str], None] = 'f14c50457629'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'audit_log',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('actor_id', sa.String(), nullable=True),
        sa.Column('actor_email', sa.String(), nullable=True),
        sa.Column('entity_type', sa.String(), nullable=True),
        sa.Column('entity_id', sa.String(), nullable=True),
        sa.Column('project_id', sa.String(), nullable=True),
        sa.Column('details', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
        sa.Column('ip', sa.String(), nullable=True),
        sa.Column('user_agent', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id']),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_audit_log_action'), ['action'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_log_actor_id'), ['actor_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_log_entity_id'), ['entity_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_log_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_log_created_at'), ['created_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('audit_log', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_audit_log_created_at'))
        batch_op.drop_index(batch_op.f('ix_audit_log_project_id'))
        batch_op.drop_index(batch_op.f('ix_audit_log_entity_id'))
        batch_op.drop_index(batch_op.f('ix_audit_log_actor_id'))
        batch_op.drop_index(batch_op.f('ix_audit_log_action'))
    op.drop_table('audit_log')

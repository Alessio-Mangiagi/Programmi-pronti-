"""wbs_nodes, form_submissions.wbs_node_id (pin_id nullable)

Revision ID: d9e3f4a5b6c7
Revises: c8d2e3f4a5b6
Create Date: 2026-09-18 16:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9e3f4a5b6c7'
down_revision: Union[str, Sequence[str], None] = 'c8d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'wbs_nodes',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('project_id', sa.String(), nullable=False),
        sa.Column('parent_id', sa.String(), nullable=True),
        sa.Column('code', sa.String(), nullable=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['parent_id'], ['wbs_nodes.id'], name=op.f('fk_wbs_nodes_parent_id_wbs_nodes')),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_wbs_nodes_project_id_projects')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_wbs_nodes')),
    )
    with op.batch_alter_table('wbs_nodes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_wbs_nodes_parent_id'), ['parent_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_wbs_nodes_project_id'), ['project_id'], unique=False)
    with op.batch_alter_table('form_submissions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('wbs_node_id', sa.String(), nullable=True))
        batch_op.alter_column('pin_id', existing_type=sa.String(), nullable=True)
        batch_op.create_index(batch_op.f('ix_form_submissions_wbs_node_id'), ['wbs_node_id'], unique=False)
        batch_op.create_foreign_key('fk_form_submissions_wbs_node_id_wbs_nodes', 'wbs_nodes', ['wbs_node_id'], ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('form_submissions', schema=None) as batch_op:
        batch_op.drop_constraint('fk_form_submissions_wbs_node_id_wbs_nodes', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_form_submissions_wbs_node_id'))
        batch_op.alter_column('pin_id', existing_type=sa.String(), nullable=False)
        batch_op.drop_column('wbs_node_id')
    with op.batch_alter_table('wbs_nodes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_wbs_nodes_project_id'))
        batch_op.drop_index(batch_op.f('ix_wbs_nodes_parent_id'))
    op.drop_table('wbs_nodes')

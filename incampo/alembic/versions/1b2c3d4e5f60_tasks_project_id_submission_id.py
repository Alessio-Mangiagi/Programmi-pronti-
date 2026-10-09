"""tasks.project_id e tasks.submission_id: task sul cantiere (da moduli su WBS o generali), pin_id nullable

Revision ID: 1b2c3d4e5f60
Revises: 0a1b2c3d4e5f
Create Date: 2026-10-08 16:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1b2c3d4e5f60'
down_revision: Union[str, Sequence[str], None] = '0a1b2c3d4e5f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('project_id', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('submission_id', sa.String(), nullable=True))
        batch_op.alter_column('pin_id', existing_type=sa.String(), nullable=True)
        batch_op.create_index(batch_op.f('ix_tasks_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_submission_id'), ['submission_id'], unique=False)
        batch_op.create_foreign_key('fk_tasks_project_id_projects', 'projects', ['project_id'], ['id'])
        batch_op.create_foreign_key('fk_tasks_submission_id_form_submissions', 'form_submissions', ['submission_id'], ['id'])


def downgrade() -> None:
    """Downgrade schema. I task sul cantiere (senza pin) non hanno posto nello schema vecchio: vanno tolti prima."""
    op.execute("DELETE FROM attachments WHERE task_id IN (SELECT id FROM tasks WHERE pin_id IS NULL)")
    op.execute("DELETE FROM tasks WHERE pin_id IS NULL")
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_constraint('fk_tasks_submission_id_form_submissions', type_='foreignkey')
        batch_op.drop_constraint('fk_tasks_project_id_projects', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_tasks_submission_id'))
        batch_op.drop_index(batch_op.f('ix_tasks_project_id'))
        batch_op.alter_column('pin_id', existing_type=sa.String(), nullable=False)
        batch_op.drop_column('submission_id')
        batch_op.drop_column('project_id')

"""form_submissions.project_id: moduli generali del cantiere (senza pin né voce WBS)

Revision ID: 0a1b2c3d4e5f
Revises: 07e814f3a149
Create Date: 2026-10-08 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a1b2c3d4e5f'
down_revision: Union[str, Sequence[str], None] = '07e814f3a149'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('form_submissions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('project_id', sa.String(), nullable=True))
        batch_op.create_index(batch_op.f('ix_form_submissions_project_id'), ['project_id'], unique=False)
        batch_op.create_foreign_key('fk_form_submissions_project_id_projects', 'projects', ['project_id'], ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('form_submissions', schema=None) as batch_op:
        batch_op.drop_constraint('fk_form_submissions_project_id_projects', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_form_submissions_project_id'))
        batch_op.drop_column('project_id')

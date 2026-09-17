"""commesse, commessa_params, projects.commessa_id

Revision ID: c8d2e3f4a5b6
Revises: b7c1d2e3f4a5
Create Date: 2026-09-17 19:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c8d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = 'b7c1d2e3f4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql')


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'commessa_params',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('options', JSON, nullable=False),
        sa.Column('multi', sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'commesse',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('code', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('client', sa.String(), nullable=True),
        sa.Column('params', JSON, nullable=False),
        sa.Column('archived_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('commesse', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_commesse_code'), ['code'], unique=True)
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('commessa_id', sa.String(), nullable=True))
        batch_op.create_index(batch_op.f('ix_projects_commessa_id'), ['commessa_id'], unique=False)
        batch_op.create_foreign_key('fk_projects_commessa_id', 'commesse', ['commessa_id'], ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_constraint('fk_projects_commessa_id', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_projects_commessa_id'))
        batch_op.drop_column('commessa_id')
    with op.batch_alter_table('commesse', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_commesse_code'))
    op.drop_table('commesse')
    op.drop_table('commessa_params')

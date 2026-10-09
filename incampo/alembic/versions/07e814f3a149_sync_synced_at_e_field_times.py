"""sync: synced_at (cursore pull lato server) e field_times (LWW per campo)

Revision ID: 07e814f3a149
Revises: 689adb9ac445
Create Date: 2026-10-06 08:47:59.267934

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '07e814f3a149'
down_revision: Union[str, Sequence[str], None] = '689adb9ac445'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLES = ("pins", "form_submissions", "tasks", "attachments")


def upgrade() -> None:
    """Upgrade schema."""
    for table in TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column('synced_at', sa.DateTime(), nullable=True))
            batch_op.add_column(sa.Column('field_times', sa.JSON(), nullable=True))
        # righe esistenti: il cursore parte dall'ultima modifica nota;
        # field_times resta NULL = confronto sull'updated_at di riga (prudente)
        op.execute(f"UPDATE {table} SET synced_at = updated_at")
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.alter_column('synced_at', existing_type=sa.DateTime(), nullable=False)
            batch_op.create_index(batch_op.f(f'ix_{table}_synced_at'), ['synced_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    for table in TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_index(batch_op.f(f'ix_{table}_synced_at'))
            batch_op.drop_column('field_times')
            batch_op.drop_column('synced_at')

# "><(((º> sabusabu <º)))><"
"""users.portale_username e users.ruolo_prima_admin: profilo del portale valido in InCampo

Regola della suite dell'11/11/2026: l'utente InCampo di una persona del portale resta collegato al suo
username (non più solo all'email, che nel portale può cambiare) e l'amministratore lo decide il portale,
dandolo e togliendolo a ogni ingresso; ruolo_prima_admin è il ruolo da riprendere quando il portale lo toglie.
Gli account esistenti si collegano da soli al primo ingresso dal portale (nessun dato da migrare).

Revision ID: 2c3d4e5f6071
Revises: 1b2c3d4e5f60
Create Date: 2026-11-11 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2c3d4e5f6071'
down_revision: Union[str, Sequence[str], None] = '1b2c3d4e5f60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('portale_username', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('ruolo_prima_admin', sa.String(), nullable=True))
        batch_op.create_index(batch_op.f('ix_users_portale_username'), ['portale_username'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_portale_username'))
        batch_op.drop_column('ruolo_prima_admin')
        batch_op.drop_column('portale_username')

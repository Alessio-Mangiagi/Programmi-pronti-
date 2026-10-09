"""invite_labels, invites (credenziali preimpostate per gli inviti)

Revision ID: e1f4a5b6c7d8
Revises: d9e3f4a5b6c7
Create Date: 2026-09-23 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f4a5b6c7d8'
down_revision: Union[str, Sequence[str], None] = 'd9e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# JSON su SQLite, JSONB su Postgres: come in app/models.py
JSONType = sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql")
UserRoleEnum = sa.Enum('admin', 'manager', 'field', name='userrole')


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'invite_labels',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('role', UserRoleEnum, nullable=False),
        sa.Column('project_ids', JSONType, nullable=False),
        sa.Column('commessa_ids', JSONType, nullable=False),
        sa.Column('notify_email', sa.Boolean(), nullable=False),
        sa.Column('notify_push', sa.Boolean(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('archived_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_invite_labels')),
    )
    with op.batch_alter_table('invite_labels', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_invite_labels_name'), ['name'], unique=True)

    op.create_table(
        'invites',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('label_id', sa.String(), nullable=False),
        sa.Column('token_hash', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=True),
        sa.Column('invited_by_id', sa.String(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('accepted_at', sa.DateTime(), nullable=True),
        sa.Column('accepted_user_id', sa.String(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('email_sent_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['label_id'], ['invite_labels.id'], name=op.f('fk_invites_label_id_invite_labels')),
        sa.ForeignKeyConstraint(['invited_by_id'], ['users.id'], name=op.f('fk_invites_invited_by_id_users')),
        sa.ForeignKeyConstraint(['accepted_user_id'], ['users.id'], name=op.f('fk_invites_accepted_user_id_users')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_invites')),
    )
    with op.batch_alter_table('invites', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_invites_email'), ['email'], unique=False)
        batch_op.create_index(batch_op.f('ix_invites_label_id'), ['label_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_invites_token_hash'), ['token_hash'], unique=True)
        batch_op.create_index(batch_op.f('ix_invites_invited_by_id'), ['invited_by_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('invites', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_invites_invited_by_id'))
        batch_op.drop_index(batch_op.f('ix_invites_token_hash'))
        batch_op.drop_index(batch_op.f('ix_invites_label_id'))
        batch_op.drop_index(batch_op.f('ix_invites_email'))
    op.drop_table('invites')
    with op.batch_alter_table('invite_labels', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_invite_labels_name'))
    op.drop_table('invite_labels')

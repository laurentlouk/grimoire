"""book status

Revision ID: 2b3c4d5e6f7a
Revises: 1a2b3c4d5e6f
"""
from alembic import op
import sqlalchemy as sa

revision: str = "2b3c4d5e6f7a"
down_revision: str | None = "1a2b3c4d5e6f"


def upgrade() -> None:
    op.add_column("books", sa.Column("status", sa.String(length=12), nullable=False))
    with op.batch_alter_table("books", schema=None) as batch_op:
        batch_op.create_index("ix_books_title_year", ["title", "year"], unique=False)
    op.bulk_insert(sa.table("shelves"), [{"id": 2}])


def downgrade() -> None:
    op.drop_index("ix_books_title_year", table_name="books")
    op.drop_column("books", "status")

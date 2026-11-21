from datetime import datetime
from typing import Optional

from sqlalchemy import Column, ForeignKey, Index, Integer, Numeric, String, Table, Text, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


book_authors = Table(
    "book_authors",
    Base.metadata,
    Column("book_id", ForeignKey("books.id", ondelete="CASCADE"), primary_key=True),
    Column("author_id", ForeignKey("authors.id"), primary_key=True),
)


class Author(TimestampMixin, Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    bio: Mapped[Optional[str]] = mapped_column(Text)
    books: Mapped[list["Book"]] = relationship(secondary=book_authors, back_populates="authors")


class Book(TimestampMixin, Base):
    __tablename__ = "books"
    __table_args__ = (
        UniqueConstraint("isbn", name="uq_books_isbn"),
        Index("ix_books_title_year", "title", "year"),
        {"schema": None},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    isbn: Mapped[str] = mapped_column(String(13))
    title: Mapped[str]
    year: Mapped[int | None]
    price = Column(Numeric(10, 2), server_default="CANARY-SA-DEFAULT")
    status: Mapped[str] = mapped_column(String(12), default="CANARY-SA-CLIENT", comment="CANARY-SA-COMMENT")
    shelf_id: Mapped[Optional[int]] = mapped_column("shelf", ForeignKey("shelves.id", ondelete="SET NULL"))
    authors: Mapped[list[Author]] = relationship(secondary=book_authors, back_populates="books")


class Shelf(Base):
    __tablename__ = "shelves"

    id = Column(Integer, primary_key=True)
    label = Column(String(40), nullable=False, unique=True)

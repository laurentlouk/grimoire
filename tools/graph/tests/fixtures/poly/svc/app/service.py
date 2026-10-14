from .models import User, Ledger
from app import util


def create(name):
    u = User()
    u.save()
    return util.slug(name)


DEFAULT = Ledger()


def audit():
    return DEFAULT.entries.save_all()


def refresh(rows):
    return rows.update()

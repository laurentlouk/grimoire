from .models import User, Ledger, Order, Café
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


def order_total():
    return Order().total_order()


def touch():
    return Ledger().update()


def commande():
    return Café.fabrique().servir()


def audit2():
    return DEFAULT.get_ledger().save_all()

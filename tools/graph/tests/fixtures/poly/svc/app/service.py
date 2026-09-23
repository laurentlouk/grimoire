from .models import User
from app import util


def create(name):
    u = User()
    u.save()
    return util.slug(name)

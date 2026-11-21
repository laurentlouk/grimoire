from django.db.models.signals import post_save
from .tasks import on_user_saved, send_welcome

post_save.connect(on_user_saved)


def queue(user):
    send_welcome.apply_async(args=[user.id])

from .celery import app


@app.task
def send_welcome(user_id):
    return user_id


def on_user_saved(sender, instance, **kwargs):
    send_welcome.delay(instance.id)


def shadow(send_welcome):
    return register(send_welcome)


def by_name():
    return lookup("send_welcome")

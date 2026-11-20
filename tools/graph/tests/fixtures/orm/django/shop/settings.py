import os

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
INSTALLED_APPS = ["accounts", "catalog", "orders", "core"]
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "shop",
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

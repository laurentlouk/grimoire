from app.settings import settings


def expiry():
    return settings.ACCESS_TOKEN_EXPIRE_MINUTES

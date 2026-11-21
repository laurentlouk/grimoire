from app.core.config import settings


def test_get_users_me(client):
    r = client.get(f"{settings.API_V1_STR}/users/me")
    assert r.status_code == 200

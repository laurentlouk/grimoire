from app.service import create


def test_create():
    assert create("A") == "a"

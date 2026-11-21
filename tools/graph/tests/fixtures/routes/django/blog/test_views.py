def test_detail(client):
    response = client.get("/blog/3/")
    assert response.status_code == 200

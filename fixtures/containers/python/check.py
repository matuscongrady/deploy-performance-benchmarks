from fastapi.testclient import TestClient
from app import app

with TestClient(app) as client:
    assert client.get("/version").json()["service"] == "commerce-api"
    result = client.post("/quote", json={"lines": [{"productId": "coffee", "quantity": 2}, {"productId": "mug", "quantity": 1}]})
    assert result.json()["total"] == "33.00"
    receipt = client.post("/receipt", json={"orderId": "order-100", "placedAt": "2025-01-15T12:00:00Z", "total": "33.00"})
    assert receipt.json()["html"] == "<p>Order order-100, 2025-01-15: USD 33.00</p>"
    assert client.post("/quote", json={"lines": [{"productId": "coffee", "quantity": -1}]}).status_code == 422
print("Verified Python API: version, quote, receipt and invalid input.")

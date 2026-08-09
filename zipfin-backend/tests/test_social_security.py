"""Authentication regression coverage for server-authoritative social actions."""

from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_social_mutations_reject_unauthenticated_requests() -> None:
    requests = (
        client.post("/social/posts/post_123/like"),
        client.post("/social/posts/post_123/comments", json={"text": "hello"}),
        client.post("/social/posts/post_123/share", json={"recipient_uid": "user_456"}),
        client.post("/social/reports", json={"target_type": "post", "target_id": "post_123", "reason": "spam"}),
        client.put("/social/users/user_456/blocked"),
        client.put("/social/users/user_456/muted"),
    )
    assert all(response.status_code == 401 for response in requests)


def test_social_relationship_reads_reject_unauthenticated_requests() -> None:
    response = client.get("/social/users/user_456/followers")
    assert response.status_code == 401


def test_gift_intents_reject_unauthenticated_requests() -> None:
    response = client.post("/gifts/intents", json={"recipient_uid": "user_456", "product": {"id": "p1"}})
    assert response.status_code == 401


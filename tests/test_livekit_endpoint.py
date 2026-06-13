import pytest
import uuid
from unittest.mock import patch
from src.domain.models import SessionStatus

pytestmark = pytest.mark.asyncio


async def test_token_endpoint_not_found(client):
    """Test that requesting a token for a non-existent session returns 404."""
    missing_id = str(uuid.uuid4())
    headers = {
        "X-User-ID": "agent_1",
        "X-User-Role": "agent",
    }
    response = await client.get(f"/api/v1/sessions/{missing_id}/livekit-token", headers=headers)
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


async def test_token_endpoint_not_active(client):
    """Test that requesting a token for a CREATED session returns 400."""
    headers = {
        "X-User-ID": "agent_1",
        "X-User-Role": "agent",
    }
    create_res = await client.post("/api/v1/sessions/", json={"agent_id": "agent_1"}, headers=headers)
    session_id = create_res.json()["id"]

    response = await client.get(f"/api/v1/sessions/{session_id}/livekit-token", headers=headers)
    assert response.status_code == 400
    assert "media is only available when the session is active" in response.json()["detail"].lower()


async def test_token_endpoint_participant_not_found(client):
    """Test that requesting a token for a user who is not a participant returns 403."""
    headers = {
        "X-User-ID": "agent_1",
        "X-User-Role": "agent",
    }
    create_res = await client.post("/api/v1/sessions/", json={"agent_id": "agent_1"}, headers=headers)
    session_id = create_res.json()["id"]
    invite_token = create_res.json()["invite_token"]

    await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={"invite_token": invite_token},
        headers=headers
    )

    unauth_headers = {
        "X-User-ID": "customer_1",
        "X-User-Role": "customer",
    }
    response = await client.get(f"/api/v1/sessions/{session_id}/livekit-token", headers=unauth_headers)
    assert response.status_code == 403
    assert "participant does not belong" in response.json()["detail"].lower()


async def test_token_endpoint_participant_left(client):
    """Test that requesting a token for a participant who has LEFT returns 400."""
    # 1. Create session
    agent_headers = {
        "X-User-ID": "agent_1",
        "X-User-Role": "agent",
    }
    create_res = await client.post("/api/v1/sessions/", json={"agent_id": "agent_1"}, headers=agent_headers)
    session_id = create_res.json()["id"]
    invite_token = create_res.json()["invite_token"]

    # 2. Join as agent
    join_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={"invite_token": invite_token},
        headers=agent_headers
    )
    participant_id = join_res.json()["id"]

    # 3. Join as customer (so session remains ACTIVE after agent leaves)
    customer_headers = {
        "X-User-ID": "customer_1",
        "X-User-Role": "customer",
    }
    await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={"invite_token": invite_token},
        headers=customer_headers
    )

    # 4. Agent leaves session
    await client.post(f"/api/v1/sessions/{session_id}/participants/{participant_id}/leave", headers=agent_headers)

    # 5. Request token for Agent (should fail because participant has LEFT, though session is still ACTIVE)
    response = await client.get(f"/api/v1/sessions/{session_id}/livekit-token", headers=agent_headers)
    assert response.status_code == 400
    assert "already left" in response.json()["detail"].lower()


async def test_token_endpoint_success(client):
    """Test that requesting a token successfully returns a mock JWT and URL."""
    headers = {
        "X-User-ID": "agent_1",
        "X-User-Role": "agent",
    }
    create_res = await client.post("/api/v1/sessions/", json={"agent_id": "agent_1"}, headers=headers)
    session_id = create_res.json()["id"]
    invite_token = create_res.json()["invite_token"]

    await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={"invite_token": invite_token},
        headers=headers
    )

    with patch("src.services.livekit_service.LiveKitService.generate_token") as mock_gen:
        mock_gen.return_value = "mock_jwt_token_str"
        response = await client.get(f"/api/v1/sessions/{session_id}/livekit-token", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["token"] == "mock_jwt_token_str"
        assert "livekit_url" in data


async def test_token_endpoint_livekit_generation_failed(client):
    """Test that requesting a token returns 503 if LiveKit generation fails."""
    headers = {
        "X-User-ID": "agent_1",
        "X-User-Role": "agent",
    }
    create_res = await client.post("/api/v1/sessions/", json={"agent_id": "agent_1"}, headers=headers)
    session_id = create_res.json()["id"]
    invite_token = create_res.json()["invite_token"]

    await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={"invite_token": invite_token},
        headers=headers
    )

    with patch("src.services.livekit_service.LiveKitService.generate_token") as mock_gen:
        mock_gen.return_value = None
        response = await client.get(f"/api/v1/sessions/{session_id}/livekit-token", headers=headers)
        assert response.status_code == 503
        assert "generation failed" in response.json()["detail"].lower()

import pytest
import uuid

from src.domain.models import SessionStatus

pytestmark = pytest.mark.asyncio


async def test_api_create_session(client):
    """Test POST /api/v1/sessions/ creates session and returns correct JSON structure."""
    payload = {"agent_id": "agent_test_api"}
    headers = {
        "X-User-ID": "agent_test_api",
        "X-User-Role": "agent",
    }
    response = await client.post("/api/v1/sessions/", json=payload, headers=headers)
    
    assert response.status_code == 201
    data = response.json()
    assert data["agent_id"] == "agent_test_api"
    assert data["status"] == "CREATED"
    assert "id" in data
    assert "invite_token" in data
    assert data["started_at"] is None
    assert data["ended_at"] is None


async def test_api_create_session_unauthorized(client):
    """Test POST /api/v1/sessions/ returns 403 if user role is not agent."""
    payload = {"agent_id": "agent_test_api"}
    headers = {
        "X-User-ID": "customer_1",
        "X-User-Role": "customer",
    }
    response = await client.post("/api/v1/sessions/", json=payload, headers=headers)
    assert response.status_code == 403
    assert "only agents" in response.json()["detail"].lower()


async def test_api_get_session_by_id(client):
    """Test GET /api/v1/sessions/{id} returns the session details or 404."""
    # Test 404
    missing_id = str(uuid.uuid4())
    response = await client.get(f"/api/v1/sessions/{missing_id}")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()

    # Create session
    create_response = await client.post("/api/v1/sessions/", json={"agent_id": "agent_1"})
    session_id = create_response.json()["id"]

    # Test 200
    get_response = await client.get(f"/api/v1/sessions/{session_id}")
    assert get_response.status_code == 200
    assert get_response.json()["id"] == session_id


async def test_api_validate_invite(client):
    """Test POST /api/v1/sessions/validate-invite."""
    # Create session
    create_response = await client.post("/api/v1/sessions/", json={"agent_id": "agent_1"})
    session_data = create_response.json()
    invite_token = session_data["invite_token"]
    session_id = session_data["id"]

    # Validate correct invite token
    val_response = await client.post("/api/v1/sessions/validate-invite", json={"invite_token": invite_token})
    assert val_response.status_code == 200
    assert val_response.json() == {
        "valid": True,
        "session_id": session_id,
        "status": "CREATED",
    }

    # Validate incorrect invite token
    val_fail_response = await client.post("/api/v1/sessions/validate-invite", json={"invite_token": "wrong_token"})
    assert val_fail_response.status_code == 400
    assert "not found" in val_fail_response.json()["detail"].lower()


async def test_api_session_lifecycle(client):
    """Test the session lifecycle API flow (create -> end -> end)."""
    # 1. Create session
    create_res = await client.post("/api/v1/sessions/", json={"agent_id": "agent_1"})
    session_id = create_res.json()["id"]
    
    # 2. Verify start session endpoint is removed (should return 404)
    start_res = await client.post(f"/api/v1/sessions/{session_id}/start")
    assert start_res.status_code == 404

    # 3. End session (CREATED -> ENDED)
    headers = {"X-User-ID": "agent_1", "X-User-Role": "agent"}
    end_res = await client.post(f"/api/v1/sessions/{session_id}/end", headers=headers)
    assert end_res.status_code == 200
    assert end_res.json()["status"] == "ENDED"
    assert end_res.json()["ended_at"] is not None


    # 4. Verify ended session termination is idempotent (returns 200 and the ended session status)
    re_end_res = await client.post(f"/api/v1/sessions/{session_id}/end", headers=headers)
    assert re_end_res.status_code == 200
    assert re_end_res.json()["status"] == "ENDED"



async def test_api_session_history_and_events(client):
    """Test listing sessions and events history API."""
    # Create two sessions
    r1 = await client.post("/api/v1/sessions/", json={"agent_id": "agent_1"})
    r2 = await client.post("/api/v1/sessions/", json={"agent_id": "agent_2"})
    
    s1_id = r1.json()["id"]
    s2_id = r2.json()["id"]

    # End session 1
    await client.post(
        f"/api/v1/sessions/{s1_id}/end",
        headers={"X-User-ID": "agent_1", "X-User-Role": "agent"}
    )


    # List sessions
    list_res = await client.get("/api/v1/sessions/")
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert list_data["total"] >= 2
    
    # List ended sessions only
    list_ended_res = await client.get("/api/v1/sessions/?status=ENDED")
    assert list_ended_res.status_code == 200
    ended_data = list_ended_res.json()
    ended_ids = [s["id"] for s in ended_data["sessions"]]
    assert s1_id in ended_ids
    assert s2_id not in ended_ids

    # Query events for session 1 (should be CREATED and ENDED)
    events_res = await client.get(
        f"/api/v1/sessions/{s1_id}/events",
        headers={"X-User-ID": "agent_1", "X-User-Role": "agent"}
    )
    assert events_res.status_code == 200

    events = events_res.json()
    assert len(events) == 2
    assert events[0]["event_type"] == "SESSION_CREATED"
    assert events[1]["event_type"] == "SESSION_ENDED"

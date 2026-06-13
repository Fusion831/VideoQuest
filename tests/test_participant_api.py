import pytest
import uuid

pytestmark = pytest.mark.asyncio


async def test_api_participant_join_agent(client):
    """Test joining a session as the assigned agent."""
    # 1. Create a session
    agent_id = "agent_test_api"
    create_res = await client.post(
        "/api/v1/sessions/",
        json={"agent_id": agent_id},
        headers={"X-User-ID": agent_id, "X-User-Role": "agent"},
    )
    assert create_res.status_code == 201
    session_data = create_res.json()
    session_id = session_data["id"]
    assert session_data["status"] == "CREATED"

    # 2. Agent joins session
    join_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={},
        headers={"X-User-ID": agent_id, "X-User-Role": "agent"},
    )
    assert join_res.status_code == 201
    p_data = join_res.json()
    assert p_data["role"] == "AGENT"
    assert p_data["user_id"] == agent_id
    assert p_data["connection_status"] == "CONNECTED"

    # 3. Check session became active automatically
    session_res = await client.get(f"/api/v1/sessions/{session_id}")
    assert session_res.json()["status"] == "ACTIVE"


async def test_api_participant_join_customer_valid_invite(client):
    """Test joining a session as a customer with a valid invite token."""
    # 1. Create a session
    agent_id = "agent_test_api"
    create_res = await client.post(
        "/api/v1/sessions/",
        json={"agent_id": agent_id},
        headers={"X-User-ID": agent_id, "X-User-Role": "agent"},
    )
    session_data = create_res.json()
    session_id = session_data["id"]
    invite_token = session_data["invite_token"]

    # 2. Customer joins with valid invite token
    join_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={"invite_token": invite_token},
        headers={"X-User-ID": "customer_1", "X-User-Role": "customer"},
    )
    assert join_res.status_code == 201
    p_data = join_res.json()
    assert p_data["role"] == "CUSTOMER"
    assert p_data["user_id"] == "customer_1"
    assert p_data["connection_status"] == "CONNECTED"


async def test_api_participant_join_customer_invalid_invite(client):
    """Test customer join fails with 400 if the invite token is invalid."""
    # 1. Create a session
    agent_id = "agent_test_api"
    create_res = await client.post(
        "/api/v1/sessions/",
        json={"agent_id": agent_id},
        headers={"X-User-ID": agent_id, "X-User-Role": "agent"},
    )
    session_id = create_res.json()["id"]

    # 2. Customer joins with invalid invite token
    join_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={"invite_token": "bad_token"},
        headers={"X-User-ID": "customer_1", "X-User-Role": "customer"},
    )
    assert join_res.status_code == 400
    assert "invite token validation failed" in join_res.json()["detail"].lower()


async def test_api_participant_join_unauthorized_agent(client):
    """Test agent join fails with 403 if the user is not the assigned agent."""
    # 1. Create a session
    agent_id = "agent_test_api"
    create_res = await client.post(
        "/api/v1/sessions/",
        json={"agent_id": agent_id},
        headers={"X-User-ID": agent_id, "X-User-Role": "agent"},
    )
    session_id = create_res.json()["id"]

    # 2. Different agent joins
    join_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={},
        headers={"X-User-ID": "agent_unauthorized", "X-User-Role": "agent"},
    )
    assert join_res.status_code == 403
    assert "only the assigned agent can join" in join_res.json()["detail"].lower()


async def test_api_participant_leave_and_disconnect(client):
    """Test participant leave, disconnect, and reconnect endpoints."""
    # 1. Create session and join agent
    agent_id = "agent_1"
    create_res = await client.post("/api/v1/sessions/", json={"agent_id": agent_id})
    session_id = create_res.json()["id"]
    join_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={},
        headers={"X-User-ID": agent_id, "X-User-Role": "agent"},
    )
    participant_id = join_res.json()["id"]

    # 2. Test Disconnect
    disc_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/{participant_id}/disconnect"
    )
    assert disc_res.status_code == 200
    assert disc_res.json()["connection_status"] == "DISCONNECTED"

    # 3. Test Reconnect
    rec_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/{participant_id}/reconnect"
    )
    assert rec_res.status_code == 200
    assert rec_res.json()["connection_status"] == "CONNECTED"

    # 4. Test Leave
    leave_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/{participant_id}/leave"
    )
    assert leave_res.status_code == 200
    assert leave_res.json()["connection_status"] == "LEFT"
    assert leave_res.json()["left_at"] is not None

    # 5. Idempotent Leave
    re_leave_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/{participant_id}/leave"
    )
    assert re_leave_res.status_code == 200
    assert re_leave_res.json()["connection_status"] == "LEFT"


async def test_api_participant_invalid_reconnect(client):
    """Test reconnecting a participant who is not disconnected returns 400."""
    # 1. Create session and join agent
    agent_id = "agent_1"
    create_res = await client.post("/api/v1/sessions/", json={"agent_id": agent_id})
    session_id = create_res.json()["id"]
    join_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={},
        headers={"X-User-ID": agent_id, "X-User-Role": "agent"},
    )
    participant_id = join_res.json()["id"]

    # Participant is currently CONNECTED, so reconnect should fail
    rec_res = await client.post(
        f"/api/v1/sessions/{session_id}/participants/{participant_id}/reconnect"
    )
    assert rec_res.status_code == 400
    assert "invalid connection status transition" in rec_res.json()["detail"].lower()


async def test_api_get_participants_list(client):
    """Test retrieving the list of participants in a session."""
    agent_id = "agent_1"
    create_res = await client.post("/api/v1/sessions/", json={"agent_id": agent_id})
    session_data = create_res.json()
    session_id = session_data["id"]
    invite_token = session_data["invite_token"]

    # Join agent
    await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={},
        headers={"X-User-ID": agent_id, "X-User-Role": "agent"},
    )

    # Join customer
    await client.post(
        f"/api/v1/sessions/{session_id}/participants/join",
        json={"invite_token": invite_token},
        headers={"X-User-ID": "customer_1", "X-User-Role": "customer"},
    )

    # List participants
    list_res = await client.get(f"/api/v1/sessions/{session_id}/participants")
    assert list_res.status_code == 200
    participants = list_res.json()
    assert len(participants) == 2
    roles = {p["role"] for p in participants}
    assert roles == {"AGENT", "CUSTOMER"}

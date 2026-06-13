import pytest
import uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from src.main import app
from src.domain.models import SessionStatus, ParticipantRole
from src.infrastructure.repositories import SessionRepository, ParticipantRepository
from src.api.dependencies import get_db_session

class MockSessionContext:
    def __init__(self, session):
        self.session = session
    async def __aenter__(self):
        return self.session
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass

@pytest.mark.anyio
async def test_video_escalation_websocket_broadcast(db_session, client):
    async def override_get_db_session():
        yield db_session
    app.dependency_overrides[get_db_session] = override_get_db_session

    session_repo = SessionRepository(db_session)
    participant_repo = ParticipantRepository(db_session)

    # 1. Create session with ACTIVE status assigned to agent_1
    from src.domain.models import DomainSession, DomainParticipant
    session = DomainSession(agent_id="agent_1")
    session.status = SessionStatus.ACTIVE
    session.video_escalation_status = "NOT_STARTED"
    await session_repo.save(session)

    # 2. Create customer and agent participants
    agent_part = DomainParticipant(session_id=session.id, user_id="agent_1", role=ParticipantRole.AGENT)
    customer_part = DomainParticipant(session_id=session.id, user_id="cust_1", role=ParticipantRole.CUSTOMER)
    await participant_repo.save(agent_part)
    await participant_repo.save(customer_part)
    await db_session.commit()

    # 3. Establish customer's WebSocket connection
    test_client = TestClient(app)
    with patch("src.api.routes.AsyncSessionLocal", lambda: MockSessionContext(db_session)):
        with test_client.websocket_connect(f"/api/v1/sessions/{session.id}/ws?participant_id={customer_part.id}") as customer_ws:
            # First message received is PARTICIPANT_RECONNECTED
            welcome = customer_ws.receive_json()
            assert welcome["event_type"] == "PARTICIPANT_RECONNECTED"

            # 4. Agent requests video via the API endpoint
            headers = {
                "X-User-ID": "agent_1",
                "X-User-Role": "agent",
            }
            api_res = await client.post(
                f"/api/v1/sessions/{session.id}/request-video",
                headers=headers
            )
            assert api_res.status_code == 200
            assert api_res.json()["video_escalation_status"] == "REQUESTED"

            # 5. Verify the customer receives the SYSTEM message via WebSocket
            ws_msg = customer_ws.receive_json()
            assert ws_msg["event_type"] == "MESSAGE_RECEIVED"
            payload = ws_msg["payload"]
            assert payload["message_type"] == "SYSTEM"
            assert payload["metadata"]["type"] == "VIDEO_REQUESTED"

    app.dependency_overrides.clear()

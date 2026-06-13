import pytest
import uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect
from src.main import app
from src.domain.models import SessionStatus, ParticipantConnectionStatus, ParticipantRole
from src.infrastructure.repositories import SessionRepository, ParticipantRepository
from src.core.identity import Identity
from src.api.dependencies import get_db_session

class MockSessionContext:
    def __init__(self, session):
        self.session = session
    async def __aenter__(self):
        return self.session
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass

@pytest.mark.anyio
async def test_websocket_session_not_found(db_session):
    async def override_get_db_session():
        yield db_session
    app.dependency_overrides[get_db_session] = override_get_db_session

    client = TestClient(app)
    session_id = str(uuid.uuid4())
    
    with patch("src.api.routes.AsyncSessionLocal", lambda: MockSessionContext(db_session)):
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/api/v1/sessions/{session_id}/ws") as websocket:
                websocket.receive_text()
        assert exc_info.value.code == 4000
    app.dependency_overrides.clear()

@pytest.mark.anyio
async def test_websocket_session_ended(db_session):
    async def override_get_db_session():
        yield db_session
    app.dependency_overrides[get_db_session] = override_get_db_session

    # Create an ended session
    session_repo = SessionRepository(db_session)
    from src.domain.models import DomainSession
    session = DomainSession(agent_id="agent_1")
    session.status = SessionStatus.ENDED
    await session_repo.save(session)
    await db_session.commit()

    client = TestClient(app)
    with patch("src.api.routes.AsyncSessionLocal", lambda: MockSessionContext(db_session)):
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/api/v1/sessions/{session.id}/ws") as websocket:
                websocket.receive_text()
        assert exc_info.value.code == 4000
    app.dependency_overrides.clear()

@pytest.mark.anyio
async def test_websocket_participant_not_found(db_session):
    async def override_get_db_session():
        yield db_session
    app.dependency_overrides[get_db_session] = override_get_db_session

    # Create active session
    session_repo = SessionRepository(db_session)
    from src.domain.models import DomainSession
    session = DomainSession(agent_id="agent_1")
    session.status = SessionStatus.ACTIVE
    await session_repo.save(session)
    await db_session.commit()

    client = TestClient(app)
    bad_part_id = str(uuid.uuid4())
    with patch("src.api.routes.AsyncSessionLocal", lambda: MockSessionContext(db_session)):
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/api/v1/sessions/{session.id}/ws?participant_id={bad_part_id}") as websocket:
                websocket.receive_text()
        assert exc_info.value.code == 4001
    app.dependency_overrides.clear()

@pytest.mark.anyio
async def test_websocket_participant_left(db_session):
    async def override_get_db_session():
        yield db_session
    app.dependency_overrides[get_db_session] = override_get_db_session

    # Create active session
    session_repo = SessionRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    from src.domain.models import DomainSession, DomainParticipant
    session = DomainSession(agent_id="agent_1")
    session.status = SessionStatus.ACTIVE
    await session_repo.save(session)
    
    participant = DomainParticipant(session_id=session.id, user_id="cust_1", role=ParticipantRole.CUSTOMER)
    participant.connection_status = ParticipantConnectionStatus.LEFT
    await participant_repo.save(participant)
    await db_session.commit()

    client = TestClient(app)
    with patch("src.api.routes.AsyncSessionLocal", lambda: MockSessionContext(db_session)):
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/api/v1/sessions/{session.id}/ws?participant_id={participant.id}") as websocket:
                websocket.receive_text()
        assert exc_info.value.code == 4002
    app.dependency_overrides.clear()

@pytest.mark.anyio
async def test_websocket_read_only_viewer(db_session):
    async def override_get_db_session():
        yield db_session
    app.dependency_overrides[get_db_session] = override_get_db_session

    # Create active session
    session_repo = SessionRepository(db_session)
    from src.domain.models import DomainSession
    session = DomainSession(agent_id="agent_1")
    session.status = SessionStatus.ACTIVE
    await session_repo.save(session)
    await db_session.commit()

    client = TestClient(app)
    with patch("src.api.routes.AsyncSessionLocal", lambda: MockSessionContext(db_session)):
        with client.websocket_connect(f"/api/v1/sessions/{session.id}/ws") as websocket:
            # Connection accepted successfully as read-only viewer
            pass
    app.dependency_overrides.clear()

@pytest.mark.anyio
async def test_websocket_chat_send_and_receive(db_session):
    async def override_get_db_session():
        yield db_session
    app.dependency_overrides[get_db_session] = override_get_db_session

    # Create active session and participant
    session_repo = SessionRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    from src.domain.models import DomainSession, DomainParticipant
    session = DomainSession(agent_id="agent_1")
    session.status = SessionStatus.ACTIVE
    await session_repo.save(session)
    
    participant = DomainParticipant(session_id=session.id, user_id="agent_1", role=ParticipantRole.AGENT)
    await participant_repo.save(participant)
    await db_session.commit()

    client = TestClient(app)
    with patch("src.api.routes.AsyncSessionLocal", lambda: MockSessionContext(db_session)):
        with client.websocket_connect(f"/api/v1/sessions/{session.id}/ws?participant_id={participant.id}") as websocket:
            # First message received is PARTICIPANT_RECONNECTED
            welcome = websocket.receive_json()
            assert welcome["event_type"] == "PARTICIPANT_RECONNECTED"
            
            # Send message
            websocket.send_json({
                "event": "SEND_MESSAGE",
                "data": {"content": "Hello world!"}
            })
            
            # Receive broadcasted message back
            received = websocket.receive_json()
            assert received["event_type"] == "MESSAGE_RECEIVED"
            assert received["payload"]["content"] == "Hello world!"
            assert received["payload"]["sender_participant_id"] == str(participant.id)

    app.dependency_overrides.clear()

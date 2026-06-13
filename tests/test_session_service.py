import pytest
from unittest.mock import patch
import uuid

from src.core.exceptions import (
    DomainException,
    SessionNotFound,
    InvalidInvite,
)
from src.core.identity import Identity
from src.domain.models import SessionStatus, DomainSession
from src.domain.events import SessionEventType
from src.infrastructure.repositories import SessionRepository, SessionEventRepository
from src.services.session_service import SessionService

pytestmark = pytest.mark.asyncio


async def get_service(db_session) -> SessionService:
    session_repo = SessionRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    return SessionService(session_repo, event_repo, db_session)


async def test_service_create_session(db_session):
    """Verify session creation persists both session and creation event in one transaction."""
    service = await get_service(db_session)
    agent_id = "agent_abc"
    identity = Identity(user_id=agent_id, role="agent")

    session = await service.create_session(identity)
    
    assert session.agent_id == agent_id
    assert session.status == SessionStatus.CREATED

    # Retrieve from repository to verify persistence
    persisted_session = await service.get_session(session.id)
    assert persisted_session.id == session.id

    # Verify event was persisted
    events = await service.get_session_events(session.id)
    assert len(events) == 1
    assert events[0].event_type == SessionEventType.SESSION_CREATED
    assert events[0].metadata.get("agent_id") == agent_id


async def test_service_create_session_unauthorized(db_session):
    """Verify that a customer cannot create a session."""
    service = await get_service(db_session)
    customer_identity = Identity(user_id="customer_1", role="customer")
    
    with pytest.raises(DomainException) as exc_info:
        await service.create_session(customer_identity)
    assert "Only agents" in str(exc_info.value)


async def test_service_get_session_not_found(db_session):
    """Verify that looking up a missing session raises SessionNotFound."""
    service = await get_service(db_session)
    with pytest.raises(SessionNotFound):
        await service.get_session(uuid.uuid4())


async def test_service_validate_invite(db_session):
    """Verify invite validation rules for created and ended sessions."""
    service = await get_service(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await service.create_session(agent_identity)

    # CREATED session invite should be valid
    validated = await service.validate_invite(session.invite_token)
    assert validated.id == session.id

    # ENDED session invite should be invalid
    await service.end_session(session.id, agent_identity)
    with pytest.raises(InvalidInvite) as exc_info:
        await service.validate_invite(session.invite_token)
    assert "ended" in exc_info.value.reason


async def test_service_validate_invite_not_found(db_session):
    """Verify that validate_invite raises InvalidInvite if the token is unknown."""
    service = await get_service(db_session)
    with pytest.raises(InvalidInvite) as exc_info:
        await service.validate_invite("non-existent-token")
    assert "not found" in exc_info.value.reason


async def test_service_end_session(db_session):
    """Verify end session transitions to ENDED and generates correct event."""
    service = await get_service(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await service.create_session(agent_identity)

    ended_session = await service.end_session(session.id, agent_identity)
    assert ended_session.status == SessionStatus.ENDED
    assert ended_session.ended_at is not None

    # Verify event history
    events = await service.get_session_events(session.id)
    assert len(events) == 2
    assert events[0].event_type == SessionEventType.SESSION_CREATED
    assert events[1].event_type == SessionEventType.SESSION_ENDED
    assert events[1].metadata.get("ended_by") == "agent_1"


async def test_service_end_session_idempotent(db_session):
    """Verify end session is idempotent and does not create duplicate events."""
    service = await get_service(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await service.create_session(agent_identity)

    # First end call
    await service.end_session(session.id, agent_identity)
    events_first = await service.get_session_events(session.id)
    assert len(events_first) == 2  # CREATED and ENDED

    # Second end call (should be a no-op)
    ended_session = await service.end_session(session.id, agent_identity)
    assert ended_session.status == SessionStatus.ENDED
    
    events_second = await service.get_session_events(session.id)
    assert len(events_second) == 2  # Verify no duplicate events are created


async def test_service_list_sessions(db_session):
    """Verify list sessions pagination and filtering features."""
    service = await get_service(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    
    s1 = await service.create_session(agent_identity)
    s2 = await service.create_session(agent_identity)
    s3 = await service.create_session(agent_identity)

    await service.end_session(s1.id, agent_identity)  # s1 is ENDED
    # s2 and s3 remain CREATED

    # Retrieve all
    sessions, total = await service.list_sessions(limit=10, offset=0)
    assert total == 3
    assert len(sessions) == 3

    # Filter by CREATED
    sessions, total = await service.list_sessions(status="CREATED")
    assert total == 2

    # Filter by ENDED
    sessions, total = await service.list_sessions(status="ENDED")
    assert total == 1
    assert sessions[0].id == s1.id


async def test_service_transaction_rollback(db_session):
    """Verify that database transactions roll back completely if an error occurs."""
    service = await get_service(db_session)
    agent_identity = Identity(user_id="agent_error", role="agent")
    
    # We patch the event_repo.save to raise an exception during creation
    with patch.object(SessionEventRepository, 'save', side_effect=Exception("DB Failure")):
        with pytest.raises(Exception) as exc_info:
            await service.create_session(agent_identity)
        assert "DB Failure" in str(exc_info.value)
        
        # Verify the session was NOT saved (rolled back)
        sessions, total = await service.list_sessions()
        assert total == 0

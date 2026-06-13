import pytest
from unittest.mock import patch
import uuid

from src.core.exceptions import (
    DomainException,
    SessionNotFound,
    SessionAlreadyEnded,
    InvalidInvite,
    ParticipantNotFound,
    ParticipantAlreadyJoined,
    ParticipantAlreadyLeft,
    InvalidConnectionTransition,
)
from src.core.identity import Identity
from src.domain.models import SessionStatus, DomainSession, ParticipantRole, ParticipantConnectionStatus
from src.domain.events import SessionEventType
from src.infrastructure.repositories import SessionRepository, SessionEventRepository, ParticipantRepository
from src.services.session_service import SessionService
from src.services.participant_service import ParticipantService

pytestmark = pytest.mark.asyncio


async def get_services(db_session):
    session_repo = SessionRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    session_service = SessionService(session_repo, event_repo, db_session)
    participant_service = ParticipantService(session_repo, event_repo, participant_repo, db_session)
    return session_service, participant_service


async def test_participant_join_flow(db_session):
    session_service, participant_service = await get_services(db_session)
    agent_id = "agent_1"
    agent_identity = Identity(user_id=agent_id, role="agent")
    
    # Create session
    session = await session_service.create_session(agent_identity)
    assert session.status == SessionStatus.CREATED
    
    # 1. Agent joins -> activates session automatically (Option A chosen)
    agent_participant = await participant_service.join_session(session.id, agent_identity)
    assert agent_participant.role == ParticipantRole.AGENT
    assert agent_participant.user_id == agent_id
    assert agent_participant.connection_status == ParticipantConnectionStatus.CONNECTED
    
    # Verify session activated
    activated_session = await session_service.get_session(session.id)
    assert activated_session.status == SessionStatus.ACTIVE
    assert activated_session.started_at is not None
    
    # Verify events: SESSION_CREATED, PARTICIPANT_JOINED, SESSION_STARTED
    events = await session_service.get_session_events(session.id, initiator=agent_identity)
    assert len(events) == 3
    assert events[0].event_type == SessionEventType.SESSION_CREATED
    assert events[1].event_type == SessionEventType.PARTICIPANT_JOINED
    assert events[2].event_type == SessionEventType.SESSION_STARTED


    # 2. Customer joins with invite token
    cust_id = "customer_1"
    cust_identity = Identity(user_id=cust_id, role="customer")
    cust_participant = await participant_service.join_session(
        session.id, cust_identity, invite_token=session.invite_token
    )
    assert cust_participant.role == ParticipantRole.CUSTOMER
    assert cust_participant.user_id == cust_id
    assert cust_participant.connection_status == ParticipantConnectionStatus.CONNECTED

    # Verify events count is now 4 (added PARTICIPANT_JOINED for customer)
    events = await session_service.get_session_events(session.id, initiator=agent_identity)
    assert len(events) == 4
    assert events[3].event_type == SessionEventType.PARTICIPANT_JOINED



async def test_participant_join_validations(db_session):
    session_service, participant_service = await get_services(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)
    
    # 1. Session not found
    with pytest.raises(SessionNotFound):
        await participant_service.join_session(uuid.uuid4(), agent_identity)
        
    # 2. Unauthorized agent
    unauthorized_agent = Identity(user_id="agent_2", role="agent")
    with pytest.raises(DomainException) as exc_info:
        await participant_service.join_session(session.id, unauthorized_agent)
    assert "Only the assigned agent" in str(exc_info.value)
    
    # 3. Customer invalid invite
    cust_identity = Identity(user_id="cust_1", role="customer")
    with pytest.raises(InvalidInvite):
        await participant_service.join_session(session.id, cust_identity, invite_token="wrong_token")

    # 4. Join ended session
    await session_service.end_session(session.id, agent_identity)
    with pytest.raises(SessionAlreadyEnded):
        await participant_service.join_session(session.id, agent_identity)


async def test_duplicate_join_and_refresh_handling(db_session):
    session_service, participant_service = await get_services(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)
    
    # First Join
    p1 = await participant_service.join_session(session.id, agent_identity)
    
    # Duplicate Join (same agent, already connected) -> should return existing p1 gracefully
    p2 = await participant_service.join_session(session.id, agent_identity)
    assert p1.id == p2.id
    
    # Disconnect agent
    await participant_service.disconnect_participant(session.id, p1.id)
    disconnected_p = await participant_service.get_session_participants(session.id, initiator=agent_identity)
    assert disconnected_p[0].connection_status == ParticipantConnectionStatus.DISCONNECTED

    
    # Re-Join (triggers automatic reconnect on join)
    p3 = await participant_service.join_session(session.id, agent_identity)
    assert p3.id == p1.id
    assert p3.connection_status == ParticipantConnectionStatus.CONNECTED
    
    # Verify PARTICIPANT_RECONNECTED event was created
    events = await session_service.get_session_events(session.id, initiator=agent_identity)
    event_types = [e.event_type for e in events]
    assert SessionEventType.PARTICIPANT_RECONNECTED in event_types



async def test_participant_leave_flow(db_session):
    session_service, participant_service = await get_services(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)
    
    p = await participant_service.join_session(session.id, agent_identity)
    
    # Leave
    left_p = await participant_service.leave_session(session.id, p.id)
    assert left_p.connection_status == ParticipantConnectionStatus.LEFT
    assert left_p.left_at is not None
    
    # Verify event
    events = await session_service.get_session_events(session.id, initiator=agent_identity)
    event_types = [e.event_type for e in events]
    assert SessionEventType.PARTICIPANT_LEFT in event_types
    assert SessionEventType.SESSION_ABANDONED in event_types
    assert SessionEventType.SESSION_ENDED not in event_types

    
    # Idempotent leave (should not throw, nor add events)
    left_p_again = await participant_service.leave_session(session.id, p.id)
    assert left_p_again.connection_status == ParticipantConnectionStatus.LEFT
    
    events_again = await session_service.get_session_events(session.id, initiator=agent_identity)
    assert len(events) == len(events_again)



async def test_participant_disconnect_reconnect_flow(db_session):
    session_service, participant_service = await get_services(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)
    
    p = await participant_service.join_session(session.id, agent_identity)
    
    # Disconnect
    disc_p = await participant_service.disconnect_participant(session.id, p.id)
    assert disc_p.connection_status == ParticipantConnectionStatus.DISCONNECTED
    
    # Reconnect
    rec_p = await participant_service.reconnect_participant(session.id, p.id)
    assert rec_p.connection_status == ParticipantConnectionStatus.CONNECTED
    
    # Invalid reconnect from CONNECTED state
    with pytest.raises(InvalidConnectionTransition):
        await participant_service.reconnect_participant(session.id, p.id)
        
    # Leave and try to reconnect (should fail with InvalidConnectionTransition since LEFT is a terminal state)
    await participant_service.leave_session(session.id, p.id)
    with pytest.raises(InvalidConnectionTransition):
        await participant_service.reconnect_participant(session.id, p.id)


async def test_reconnect_ended_session(db_session):
    session_service, participant_service = await get_services(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)
    p = await participant_service.join_session(session.id, agent_identity)
    
    await participant_service.disconnect_participant(session.id, p.id)
    await session_service.end_session(session.id, agent_identity)
    
    with pytest.raises(SessionAlreadyEnded):
        await participant_service.reconnect_participant(session.id, p.id)


async def test_get_session_participants(db_session):
    session_service, participant_service = await get_services(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)
    
    # Get participants for empty session
    participants = await participant_service.get_session_participants(session.id, initiator=agent_identity)
    assert len(participants) == 0

    
    # Agent joins
    p1 = await participant_service.join_session(session.id, agent_identity)
    
    # Customer joins
    cust_identity = Identity(user_id="customer_1", role="customer")
    p2 = await participant_service.join_session(session.id, cust_identity, invite_token=session.invite_token)
    
    # List participants
    participants = await participant_service.get_session_participants(session.id, initiator=agent_identity)
    assert len(participants) == 2
    assert {participants[0].id, participants[1].id} == {p1.id, p2.id}



async def test_participant_transaction_rollback(db_session):
    session_service, participant_service = await get_services(db_session)
    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)
    
    # Mock event save failure to trigger rollback
    with patch.object(SessionEventRepository, 'save', side_effect=Exception("DB Failure")):
        with pytest.raises(Exception):
            await participant_service.join_session(session.id, agent_identity)
            
        # Verify no participant was persisted
        participants = await participant_service.get_session_participants(session.id, initiator=agent_identity)
        assert len(participants) == 0

        
        # Verify session state was not updated to ACTIVE (remains CREATED)
        s = await session_service.get_session(session.id)
        assert s.status == SessionStatus.CREATED

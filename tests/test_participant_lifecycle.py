import pytest
import uuid
from src.core.identity import Identity
from src.domain.models import SessionStatus, ParticipantRole, ParticipantConnectionStatus, ChatMessageType
from src.domain.events import SessionEventType
from src.infrastructure.repositories import SessionRepository, SessionEventRepository, ParticipantRepository, ChatMessageRepository
from src.services.session_service import SessionService
from src.services.participant_service import ParticipantService
from src.services.chat_service import ChatService
from src.infrastructure.redis import RedisPresenceService
from unittest.mock import patch

pytestmark = pytest.mark.asyncio


async def get_services(db_session):
    session_repo = SessionRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    session_service = SessionService(session_repo, event_repo, db_session, participant_repo)
    participant_service = ParticipantService(session_repo, event_repo, participant_repo, db_session)
    message_repo = ChatMessageRepository(db_session)
    chat_service = ChatService(session_repo, participant_repo, message_repo, db_session)
    return session_service, participant_service, chat_service


async def test_scenario_1_customer_leaves_agent_remains(db_session):
    """Scenario 1: Agent and Customer connected, Customer leaves.
    Expected: Customer LEFT, Agent CONNECTED, Session ACTIVE.
    """
    session_service, participant_service, _ = await get_services(db_session)
    
    agent_id = "agent_s1"
    cust_id = "cust_s1"
    agent_identity = Identity(user_id=agent_id, role="agent")
    cust_identity = Identity(user_id=cust_id, role="customer")
    
    # Setup session
    session = await session_service.create_session(agent_identity)
    
    # Join both
    agent_p = await participant_service.join_session(session.id, agent_identity)
    cust_p = await participant_service.join_session(session.id, cust_identity, invite_token=session.invite_token)
    
    # Verify both connected and session ACTIVE
    assert agent_p.connection_status == ParticipantConnectionStatus.CONNECTED
    assert cust_p.connection_status == ParticipantConnectionStatus.CONNECTED
    
    session = await session_service.get_session(session.id)
    assert session.status == SessionStatus.ACTIVE
    
    # Customer leaves
    with patch("src.infrastructure.redis.RedisPresenceService.update_presence") as mock_update:
        await participant_service.leave_session(session.id, cust_p.id)
        mock_update.assert_called_once_with(str(session.id), str(cust_p.id), "LEFT")
        
    # Re-fetch states
    participants = await participant_service.get_session_participants(session.id, initiator=agent_identity)
    p_map = {p.id: p for p in participants}

    
    assert p_map[cust_p.id].connection_status == ParticipantConnectionStatus.LEFT
    assert p_map[agent_p.id].connection_status == ParticipantConnectionStatus.CONNECTED
    
    session = await session_service.get_session(session.id)
    assert session.status == SessionStatus.ACTIVE


async def test_scenario_2_agent_leaves_customer_remains(db_session):
    """Scenario 2: Agent and Customer connected, Agent leaves.
    Expected: Agent LEFT, Customer CONNECTED, Session ACTIVE.
    """
    session_service, participant_service, _ = await get_services(db_session)
    
    agent_id = "agent_s2"
    cust_id = "cust_s2"
    agent_identity = Identity(user_id=agent_id, role="agent")
    cust_identity = Identity(user_id=cust_id, role="customer")
    
    session = await session_service.create_session(agent_identity)
    agent_p = await participant_service.join_session(session.id, agent_identity)
    cust_p = await participant_service.join_session(session.id, cust_identity, invite_token=session.invite_token)
    
    # Agent leaves
    await participant_service.leave_session(session.id, agent_p.id)
    
    participants = await participant_service.get_session_participants(session.id, initiator=cust_identity)
    p_map = {p.id: p for p in participants}

    
    assert p_map[agent_p.id].connection_status == ParticipantConnectionStatus.LEFT
    assert p_map[cust_p.id].connection_status == ParticipantConnectionStatus.CONNECTED
    
    session = await session_service.get_session(session.id)
    assert session.status == SessionStatus.ACTIVE


async def test_scenario_3_customer_leaves_agent_sends_chat(db_session):
    """Scenario 3: Customer leaves, Agent remains, Agent sends chat message.
    Expected: Message succeeds, system functions properly.
    """
    session_service, participant_service, chat_service = await get_services(db_session)
    
    agent_id = "agent_s3"
    cust_id = "cust_s3"
    agent_identity = Identity(user_id=agent_id, role="agent")
    cust_identity = Identity(user_id=cust_id, role="customer")
    
    session = await session_service.create_session(agent_identity)
    agent_p = await participant_service.join_session(session.id, agent_identity)
    cust_p = await participant_service.join_session(session.id, cust_identity, invite_token=session.invite_token)
    
    # Customer leaves
    await participant_service.leave_session(session.id, cust_p.id)
    
    # Agent sends message
    msg = await chat_service.create_message(
        session_id=session.id,
        content="Hello Customer, are you there?",
        initiator=agent_identity,
        sender_participant_id=agent_p.id,
    )
    assert msg.id is not None

    assert msg.content == "Hello Customer, are you there?"
    assert msg.sender_participant_id == agent_p.id
    
    # Fetch chat messages
    messages = await chat_service.get_messages(session.id, initiator=agent_identity)
    contents = [m.content for m in messages]
    assert "Hello Customer, are you there?" in contents


async def test_scenario_4_all_participants_leave_or_disconnect(db_session):
    """Scenario 4: All participants disconnected/left.
    Expected: Session transitions to ABANDONED, Redis expiry starts.
    """
    session_service, participant_service, _ = await get_services(db_session)
    
    agent_id = "agent_s4"
    cust_id = "cust_s4"
    agent_identity = Identity(user_id=agent_id, role="agent")
    cust_identity = Identity(user_id=cust_id, role="customer")
    
    session = await session_service.create_session(agent_identity)
    agent_p = await participant_service.join_session(session.id, agent_identity)
    cust_p = await participant_service.join_session(session.id, cust_identity, invite_token=session.invite_token)
    
    # Agent leaves (still has customer connected)
    await participant_service.leave_session(session.id, agent_p.id)
    session = await session_service.get_session(session.id)
    assert session.status == SessionStatus.ACTIVE
    
    # Customer disconnects (no connected participants remain)
    with patch("src.infrastructure.redis.RedisPresenceService.set_abandonment_expiry") as mock_expiry:
        await participant_service.disconnect_participant(session.id, cust_p.id)
        mock_expiry.assert_called_once_with(str(session.id), ttl_seconds=60)
        
    session = await session_service.get_session(session.id)
    assert session.status == SessionStatus.ABANDONED


async def test_scenario_5_all_participants_leave_explicitly(db_session):
    """Scenario 5: Agent leaves, then Customer leaves.
    Expected: Session transitions to ABANDONED on the final leave because there are no connected participants left.
    """
    session_service, participant_service, _ = await get_services(db_session)
    
    agent_id = "agent_s5"
    cust_id = "cust_s5"
    agent_identity = Identity(user_id=agent_id, role="agent")
    cust_identity = Identity(user_id=cust_id, role="customer")
    
    session = await session_service.create_session(agent_identity)
    agent_p = await participant_service.join_session(session.id, agent_identity)
    cust_p = await participant_service.join_session(session.id, cust_identity, invite_token=session.invite_token)
    
    # Agent leaves
    await participant_service.leave_session(session.id, agent_p.id)
    
    # Customer leaves
    with patch("src.infrastructure.redis.RedisPresenceService.set_abandonment_expiry") as mock_expiry:
        await participant_service.leave_session(session.id, cust_p.id)
        mock_expiry.assert_called_once_with(str(session.id), ttl_seconds=60)
        
    session = await session_service.get_session(session.id)
    assert session.status == SessionStatus.ABANDONED


async def test_scenario_6_explicit_end_session(db_session):
    """Scenario 6: Explicitly ending the session.
    Expected: Session ENDED, all participants LEFT.
    """
    session_service, participant_service, _ = await get_services(db_session)
    
    agent_id = "agent_s6"
    cust_id = "cust_s6"
    agent_identity = Identity(user_id=agent_id, role="agent")
    cust_identity = Identity(user_id=cust_id, role="customer")
    
    session = await session_service.create_session(agent_identity)
    agent_p = await participant_service.join_session(session.id, agent_identity)
    cust_p = await participant_service.join_session(session.id, cust_identity, invite_token=session.invite_token)
    
    # End session explicitly
    await session_service.end_session(session.id, agent_identity)
    
    # Verify session is ENDED
    session = await session_service.get_session(session.id)
    assert session.status == SessionStatus.ENDED
    
    # Verify all participants are LEFT
    participants = await participant_service.get_session_participants(session.id, initiator=agent_identity)
    for p in participants:
        assert p.connection_status == ParticipantConnectionStatus.LEFT


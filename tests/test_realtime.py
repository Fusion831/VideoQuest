import asyncio
import pytest
import uuid
from src.core.identity import Identity
from src.domain.models import SessionStatus, ParticipantConnectionStatus
from src.domain.events import SessionEventType
from src.infrastructure.redis import RedisPresenceService, get_redis_client
from src.services.session_service import SessionService
from src.services.participant_service import ParticipantService
from src.infrastructure.repositories import SessionRepository, SessionEventRepository, ParticipantRepository
from src.services.lifecycle_monitor import monitor_abandoned_sessions
from src.api.routes import router


async def get_services(db_session):
    session_repo = SessionRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    
    session_service = SessionService(
        session_repo=session_repo,
        event_repo=event_repo,
        db_session=db_session,
        participant_repo=participant_repo,
    )
    participant_service = ParticipantService(
        session_repo=session_repo,
        event_repo=event_repo,
        participant_repo=participant_repo,
        db_session=db_session,
    )
    return session_service, participant_service


@pytest.mark.anyio
async def test_redis_presence_operations():
    """Test basic ephemeral presence set/get and connection registration in Redis."""
    redis_presence = RedisPresenceService()
    session_id = str(uuid.uuid4())
    p1 = str(uuid.uuid4())
    p2 = str(uuid.uuid4())
    
    # Update presence
    await redis_presence.update_presence(session_id, p1, "CONNECTED")
    await redis_presence.update_presence(session_id, p2, "DISCONNECTED")
    
    # Retrieve presence
    presence = await redis_presence.get_presence(session_id)
    assert presence[p1] == "CONNECTED"
    assert presence[p2] == "DISCONNECTED"
    
    # Test connection registration
    c1 = "conn_1"
    c2 = "conn_2"
    count = await redis_presence.register_connection(session_id, c1)
    assert count == 1
    count = await redis_presence.register_connection(session_id, c2)
    assert count == 2
    
    # Test unregister connection
    count = await redis_presence.unregister_connection(session_id, c1)
    assert count == 1
    
    # Clean up
    await redis_presence.clear_session_data(session_id)
    presence_after = await redis_presence.get_presence(session_id)
    assert len(presence_after) == 0


@pytest.mark.anyio
async def test_session_abandonment_lifecycle(db_session):
    """Test transitioning to ABANDONED when all participants disconnect, and returning to ACTIVE on reconnect."""
    session_service, participant_service = await get_services(db_session)
    redis_presence = RedisPresenceService()
    
    agent_id = Identity(user_id="agent_1", role="agent")
    customer_id = Identity(user_id="customer_1", role="customer")
    
    # Create session
    session = await session_service.create_session(agent_id)
    
    # Join agent and customer
    agent = await participant_service.join_session(session.id, agent_id)
    customer = await participant_service.join_session(session.id, customer_id, invite_token=session.invite_token)
    
    # Verify session is active
    s = await session_service.get_session(session.id)
    assert s.status == SessionStatus.ACTIVE
    
    # Disconnect customer (agent still connected) -> session remains ACTIVE
    await participant_service.disconnect_participant(session.id, customer.id)
    s = await session_service.get_session(session.id)
    assert s.status == SessionStatus.ACTIVE
    
    # Disconnect agent (now all disconnected) -> session transitions to ABANDONED
    await participant_service.disconnect_participant(session.id, agent.id)
    s = await session_service.get_session(session.id)
    assert s.status == SessionStatus.ABANDONED
    
    # Check that abandonment timer was registered in Redis
    exists = await redis_presence.client.exists(redis_presence._abandoned_expiry_key(str(session.id)))
    assert exists == 1
    
    # Reconnect customer -> session returns to ACTIVE
    await participant_service.reconnect_participant(session.id, customer.id)
    s = await session_service.get_session(session.id)
    assert s.status == SessionStatus.ACTIVE
    
    # Check that abandonment timer was cleared in Redis
    exists = await redis_presence.client.exists(redis_presence._abandoned_expiry_key(str(session.id)))
    assert exists == 0
    
    # Clean up
    await redis_presence.clear_session_data(str(session.id))


@pytest.mark.anyio
async def test_abandoned_session_expiration(db_session):
    """Test that the lifecycle monitor automatically ends expired abandoned sessions."""
    session_service, participant_service = await get_services(db_session)
    redis_presence = RedisPresenceService()
    
    agent_id = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_id)
    
    agent = await participant_service.join_session(session.id, agent_id)
    
    # Disconnect agent -> transitions to ABANDONED
    await participant_service.disconnect_participant(session.id, agent.id)
    
    # Manually overwrite the Redis abandonment key TTL to expire immediately
    # (By setting the key but not setting any TTL, then deleting it, or setting a 1s TTL)
    await redis_presence.set_abandonment_expiry(str(session.id), ttl_seconds=1)
    
    # Verify key exists
    exists = await redis_presence.client.exists(redis_presence._abandoned_expiry_key(str(session.id)))
    assert exists == 1
    
    # Wait 1.5 seconds for it to expire in Redis
    await asyncio.sleep(1.5)
    
    # Verify key expired
    exists = await redis_presence.client.exists(redis_presence._abandoned_expiry_key(str(session.id)))
    assert exists == 0
    
    # Run a single check sweep by manually executing a portion of monitor_abandoned_sessions logic
    session_repo = SessionRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    
    abandoned_sessions, _ = await session_repo.list_sessions(limit=10, status=SessionStatus.ABANDONED)
    assert len(abandoned_sessions) == 1
    
    # Terminate the abandoned session
    system_identity = Identity(user_id="system_test", role="agent")
    await session_service.end_session(session.id, system_identity)
    await db_session.commit()
    
    # Verify status is now ENDED
    s = await session_service.get_session(session.id)
    assert s.status == SessionStatus.ENDED
    
    # Verify participant is now LEFT
    p = await participant_service.participant_repo.get_by_id(agent.id)
    assert p.connection_status == ParticipantConnectionStatus.LEFT

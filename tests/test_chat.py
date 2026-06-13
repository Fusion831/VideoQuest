import pytest
import uuid
import asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.identity import Identity
from src.core.exceptions import SessionAlreadyEnded, SessionNotFound, ParticipantAlreadyLeft
from src.domain.models import SessionStatus, ChatMessageType
from src.infrastructure.repositories import SessionRepository, ParticipantRepository, ChatMessageRepository, SessionEventRepository
from src.services.session_service import SessionService
from src.services.participant_service import ParticipantService
from src.services.chat_service import ChatService


@pytest.mark.anyio
async def test_chat_service_basics(db_session: AsyncSession):
    # 1. Setup session and participant repositories
    session_repo = SessionRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    message_repo = ChatMessageRepository(db_session)

    session_service = SessionService(session_repo, event_repo, db_session)
    participant_service = ParticipantService(session_repo, event_repo, participant_repo, db_session)
    chat_service = ChatService(session_repo, participant_repo, message_repo, db_session)

    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)
    
    participant = await participant_service.join_session(session.id, agent_identity)

    # 2. Send messages
    msg1 = await chat_service.create_message(
        session_id=session.id,
        content="Hello, world!",
        initiator=agent_identity,
        sender_participant_id=participant.id,
    )

    assert msg1.id is not None
    assert msg1.content == "Hello, world!"
    assert msg1.message_type == ChatMessageType.USER
    assert msg1.sender_participant_id == participant.id

    msg2 = await chat_service.create_message(
        session_id=session.id,
        content="Second message",
        initiator=agent_identity,
        sender_participant_id=participant.id,
    )

    # 3. Retrieve messages chronologically
    history = await chat_service.get_messages(session.id, initiator=agent_identity)
    # Plus system messages generated during join
    # "Agent agent_1 joined the session" and "Support session started"
    assert len(history) >= 4
    contents = [m.content for m in history]
    assert "Hello, world!" in contents
    assert "Second message" in contents
    
    # Check chronological order (created_at ascending)
    assert contents.index("Hello, world!") < contents.index("Second message")


@pytest.mark.anyio
async def test_chat_service_ended_session(db_session: AsyncSession):
    session_repo = SessionRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    message_repo = ChatMessageRepository(db_session)

    session_service = SessionService(session_repo, event_repo, db_session)
    participant_service = ParticipantService(session_repo, event_repo, participant_repo, db_session)
    chat_service = ChatService(session_repo, participant_repo, message_repo, db_session)

    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)
    participant = await participant_service.join_session(session.id, agent_identity)

    # End the session
    await session_service.end_session(session.id, agent_identity)

    # Attempt to send message, should fail
    with pytest.raises(SessionAlreadyEnded):
        await chat_service.create_message(
            session_id=session.id,
            content="Can't send on ended session",
            initiator=agent_identity,
            sender_participant_id=participant.id,
        )



@pytest.mark.anyio
async def test_system_messages_on_lifecycle(db_session: AsyncSession):
    session_repo = SessionRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    message_repo = ChatMessageRepository(db_session)

    session_service = SessionService(session_repo, event_repo, db_session)
    participant_service = ParticipantService(session_repo, event_repo, participant_repo, db_session)
    chat_service = ChatService(session_repo, participant_repo, message_repo, db_session)

    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)

    # Join agent
    agent_participant = await participant_service.join_session(session.id, agent_identity)
    
    # Get messages to verify SYSTEM messages generated
    messages = await chat_service.get_messages(session.id, initiator=agent_identity)
    contents = [m.content for m in messages]
    
    assert "Agent agent_1 joined the session" in contents
    assert "Support session started" in contents

    # Leave agent (abandon session)
    await participant_service.leave_session(session.id, agent_participant.id)
    
    messages_after = await chat_service.get_messages(session.id, initiator=agent_identity)
    contents_after = [m.content for m in messages_after]
    
    assert "Agent agent_1 left the session" in contents_after
    assert "Support session abandoned — waiting for reconnect" in contents_after


@pytest.mark.anyio
async def test_chat_rest_api(client: AsyncClient, db_session: AsyncSession):
    # Setup test data
    session_repo = SessionRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    message_repo = ChatMessageRepository(db_session)

    session_service = SessionService(session_repo, event_repo, db_session)
    participant_service = ParticipantService(session_repo, event_repo, participant_repo, db_session)
    chat_service = ChatService(session_repo, participant_repo, message_repo, db_session)

    agent_identity = Identity(user_id="agent_1", role="agent")
    session = await session_service.create_session(agent_identity)
    participant = await participant_service.join_session(session.id, agent_identity)

    # Add a user message
    await chat_service.create_message(
        session_id=session.id,
        content="Test REST message",
        initiator=agent_identity,
        sender_participant_id=participant.id,
    )

    # Fetch messages via API
    response = await client.get(f"/api/v1/sessions/{session.id}/messages")
    assert response.status_code == 200
    messages_json = response.json()
    assert len(messages_json) >= 3
    
    contents = [msg["content"] for msg in messages_json]
    assert "Test REST message" in contents
    assert "Agent agent_1 joined the session" in contents

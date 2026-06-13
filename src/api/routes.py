import json
import uuid
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status, WebSocket, WebSocketDisconnect

from src.core.exceptions import (
    DomainException,
    SessionNotFound,
    InvalidInvite,
    InvalidStateTransition,
    SessionAlreadyEnded,
    ParticipantNotFound,
    ParticipantAlreadyJoined,
    ParticipantAlreadyLeft,
    InvalidConnectionTransition,
)
from src.core.identity import Identity
from src.api.schemas import (
    SessionCreateRequest,
    SessionResponse,
    ValidateInviteRequest,
    ValidateInviteResponse,
    SessionListResponse,
    SessionEventResponse,
    ParticipantJoinRequest,
    ParticipantResponse,
    ChatMessageResponse,
)
from src.api.dependencies import get_session_service, get_participant_service, get_chat_service, get_current_identity
from src.services.session_service import SessionService
from src.services.participant_service import ParticipantService
from src.services.chat_service import ChatService

# Real-time infrastructure imports
from src.core.logging import logger
from src.infrastructure.database import AsyncSessionLocal
from src.infrastructure.repositories import SessionRepository, SessionEventRepository, ParticipantRepository, ChatMessageRepository
from src.infrastructure.redis import RedisPresenceService
from src.infrastructure.websocket_manager import ws_manager
from src.domain.models import ParticipantConnectionStatus, SessionStatus

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("/", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    request: SessionCreateRequest,
    identity: Identity = Depends(get_current_identity),
    service: SessionService = Depends(get_session_service),
):
    """Create a new session."""
    # Use headers if available, otherwise align with request body for backward compatibility
    creator = identity
    if identity.user_id == "default_user" and request.agent_id:
        creator = Identity(user_id=request.agent_id, role="agent")
        
    try:
        session = await service.create_session(creator=creator)
        return session
    except DomainException as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e.message))


@router.get("/", response_model=SessionListResponse)
async def list_sessions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status: Optional[str] = Query(None, description="Filter by status (CREATED, ACTIVE, ENDED)"),
    service: SessionService = Depends(get_session_service),
):
    """Query session history."""
    sessions, total = await service.list_sessions(limit=limit, offset=offset, status=status)
    return {"sessions": sessions, "total": total}


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    service: SessionService = Depends(get_session_service),
):
    """Retrieve details of a specific session."""
    try:
        session = await service.get_session(session_id)
        return session
    except SessionNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.post("/validate-invite", response_model=ValidateInviteResponse)
async def validate_invite(
    request: ValidateInviteRequest,
    service: SessionService = Depends(get_session_service),
):
    """Validate an invite token."""
    try:
        session = await service.validate_invite(request.invite_token)
        return {
            "valid": True,
            "session_id": session.id,
            "status": session.status.value,
        }
    except InvalidInvite as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)


@router.post("/{session_id}/end", response_model=SessionResponse)
async def end_session(
    session_id: uuid.UUID,
    identity: Identity = Depends(get_current_identity),
    service: SessionService = Depends(get_session_service),
):
    """End the session (transitions status to ENDED). This endpoint is idempotent."""
    try:
        session = await service.end_session(session_id, initiator=identity)
        return session
    except SessionNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except InvalidStateTransition as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)


@router.get("/{session_id}/events", response_model=list[SessionEventResponse])
async def get_session_events(
    session_id: uuid.UUID,
    service: SessionService = Depends(get_session_service),
):
    """Query persisted events for a specific session."""
    try:
        events = await service.get_session_events(session_id)
        return events
    except SessionNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.post("/{session_id}/participants/join", response_model=ParticipantResponse)
async def join_session(
    session_id: uuid.UUID,
    request: ParticipantJoinRequest,
    identity: Identity = Depends(get_current_identity),
    service: ParticipantService = Depends(get_participant_service),
):
    """Join a session as a participant (Agent or Customer).
    
    Returns 200 OK for reconnect, 201 Created for new join.
    """
    try:
        # Check if participant already exists (reconnect path) to return correct status
        existing = None
        try:
            from src.infrastructure.repositories import ParticipantRepository as PR
            from src.infrastructure.database import AsyncSessionLocal as ASL
            async with ASL() as check_session:
                from src.infrastructure.repositories import SessionRepository as SR
                sr = SR(check_session)
                s = await sr.get_by_id(session_id)
                if s:
                    pr = PR(check_session)
                    role_val = identity.role.upper()
                    existing = await pr.get_by_session_and_role(session_id, role_val)
        except Exception:
            pass

        participant = await service.join_session(
            session_id=session_id,
            identity=identity,
            invite_token=request.invite_token,
        )
        # Return 200 if participant already existed (reconnect), 201 if newly created
        status_code = status.HTTP_200_OK if existing else status.HTTP_201_CREATED
        from fastapi.responses import JSONResponse
        from src.api.schemas import ParticipantResponse as PR_Schema
        response_data = PR_Schema.model_validate(participant).model_dump(mode='json')
        return JSONResponse(content=response_data, status_code=status_code)
    except SessionNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except SessionAlreadyEnded as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)
    except InvalidInvite as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)
    except ParticipantAlreadyJoined as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.message)
    except ParticipantAlreadyLeft as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)
    except DomainException as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e.message))


@router.post("/{session_id}/participants/{participant_id}/leave", response_model=ParticipantResponse)
async def leave_session(
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    service: ParticipantService = Depends(get_participant_service),
):
    """Leave the session. This endpoint is idempotent."""
    try:
        participant = await service.leave_session(session_id=session_id, participant_id=participant_id)
        return participant
    except ParticipantNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except DomainException as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e.message))


@router.post("/{session_id}/participants/{participant_id}/disconnect", response_model=ParticipantResponse)
async def disconnect_participant(
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    service: ParticipantService = Depends(get_participant_service),
):
    """Mark the participant connection status as DISCONNECTED. This endpoint is idempotent."""
    try:
        participant = await service.disconnect_participant(session_id=session_id, participant_id=participant_id)
        return participant
    except ParticipantNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except InvalidConnectionTransition as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)
    except DomainException as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e.message))


@router.post("/{session_id}/participants/{participant_id}/reconnect", response_model=ParticipantResponse)
async def reconnect_participant(
    session_id: uuid.UUID,
    participant_id: uuid.UUID,
    service: ParticipantService = Depends(get_participant_service),
):
    """Reconnect a disconnected participant back to the session."""
    try:
        participant = await service.reconnect_participant(session_id=session_id, participant_id=participant_id)
        return participant
    except ParticipantNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except SessionNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except SessionAlreadyEnded as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)
    except InvalidConnectionTransition as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=e.message)
    except DomainException as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e.message))


@router.get("/{session_id}/participants", response_model=list[ParticipantResponse])
async def get_session_participants(
    session_id: uuid.UUID,
    service: ParticipantService = Depends(get_participant_service),
):
    """Query all participants in a given session."""
    try:
        participants = await service.get_session_participants(session_id=session_id)
        return participants
    except SessionNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.get("/{session_id}/messages", response_model=List[ChatMessageResponse])
async def list_session_messages(
    session_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    service: ChatService = Depends(get_chat_service),
):
    """Retrieve historical messages for a session chronologically."""
    try:
        messages = await service.get_messages(session_id, limit=limit, offset=offset)
        return messages
    except SessionNotFound as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@router.websocket("/{session_id}/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    session_id: uuid.UUID,
    participant_id: Optional[uuid.UUID] = None,
):
    """WebSocket presence connection gateway."""
    redis_presence = RedisPresenceService()
    
    # 1. Validate session status
    async with AsyncSessionLocal() as db_session:
        session_repo = SessionRepository(db_session)
        session = await session_repo.get_by_id(session_id)
        if not session or session.status == SessionStatus.ENDED:
            status_val = session.status.value if session else "NOT_FOUND"
            logger.warning(
                f"Rejected WS connection: session_id={session_id}, participant_id={participant_id}, "
                f"role=None, session_status={status_val}, "
                f"reason='Session not found or ended'"
            )
            await websocket.accept()
            await websocket.close(code=4000, reason="Invalid or ended session")
            return

    # If participant is not specified, run as a read-only viewer
    if not participant_id:
        await ws_manager.connect(str(session_id), websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await ws_manager.disconnect(str(session_id), websocket)
        return

    # 2. Validate connection credentials in short-lived DB session
    async with AsyncSessionLocal() as db_session:
        session_repo = SessionRepository(db_session)
        participant_repo = ParticipantRepository(db_session)
        event_repo = SessionEventRepository(db_session)
        
        participant_service = ParticipantService(session_repo, event_repo, participant_repo, db_session)
        
        # Check participant
        participant = await participant_repo.get_by_id(participant_id)
        if not participant or participant.session_id != session_id:
            status_val = session.status.value if session else "UNKNOWN"
            p_session_id = participant.session_id if participant else None
            logger.warning(
                f"Rejected WS connection: session_id={session_id}, participant_id={participant_id}, "
                f"role=None, session_status={status_val}, "
                f"reason='Participant not found or session mismatch (p_session_id={p_session_id})'"
            )
            await websocket.accept()
            await websocket.close(code=4001, reason="Participant not found")
            return
            
        if participant.connection_status == ParticipantConnectionStatus.LEFT:
            status_val = session.status.value if session else "UNKNOWN"
            logger.warning(
                f"Rejected WS connection: session_id={session_id}, participant_id={participant_id}, "
                f"role={participant.role.value}, session_status={status_val}, "
                f"reason='Participant already left'"
            )
            await websocket.accept()
            await websocket.close(code=4002, reason="Participant already left")
            return
            
        # Reconnect participant if disconnected
        try:
            await participant_service.reconnect_participant(session_id, participant_id)
        except Exception:
            # Let connection open if they were already CONNECTED
            pass

    # 3. Register with connection manager and Redis presence
    await ws_manager.connect(str(session_id), websocket)
    
    # Generate unique identifier for this connection
    connection_id = str(uuid.uuid4())  # TD4 fix: use UUID not memory address
    await redis_presence.update_presence(str(session_id), str(participant_id), "CONNECTED")
    await redis_presence.register_connection(str(session_id), connection_id)
    
    # Broadcast to session that participant connected/reconnected
    await ws_manager.broadcast_to_session(
        str(session_id),
        "PARTICIPANT_RECONNECTED",
        {
            "participant_id": str(participant_id),
            "user_id": participant.user_id,
            "role": participant.role.value,
        }
    )

    # 4. Enter WebSocket receive loop
    try:
        while True:
            data_str = await websocket.receive_text()
            try:
                data = json.loads(data_str)
                event_type = data.get("event")
                event_data = data.get("data", {})
                
                if event_type == "SEND_MESSAGE":
                    content = event_data.get("content", "").strip()
                    if not content:
                        continue
                    
                    async with AsyncSessionLocal() as db_session:
                        session_repo = SessionRepository(db_session)
                        participant_repo = ParticipantRepository(db_session)
                        message_repo = ChatMessageRepository(db_session)
                        chat_service = ChatService(session_repo, participant_repo, message_repo, db_session)
                        
                        try:
                            # Create and save message
                            msg = await chat_service.create_message(
                                session_id=session_id,
                                content=content,
                                sender_participant_id=participant_id,
                            )
                            # Broadcast MESSAGE_RECEIVED event to the entire session
                            await ws_manager.broadcast_to_session(
                                str(session_id),
                                "MESSAGE_RECEIVED",
                                {
                                    "id": str(msg.id),
                                    "session_id": str(msg.session_id),
                                    "sender_participant_id": str(msg.sender_participant_id) if msg.sender_participant_id else None,
                                    "message_type": msg.message_type.value,
                                    "content": msg.content,
                                    "metadata": msg.metadata,
                                    "created_at": msg.created_at.isoformat(),
                                }
                            )
                        except SessionAlreadyEnded as e:
                            await websocket.send_json({
                                "event_type": "MESSAGE_SEND_ERROR",
                                "payload": {
                                    "reason": "Session has already ended",
                                    "error": str(e)
                                }
                            })
                        except Exception as e:
                            await websocket.send_json({
                                "event_type": "MESSAGE_SEND_ERROR",
                                "payload": {
                                    "reason": "Failed to send message",
                                    "error": str(e)
                                }
                            })
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        # 5. Handle WebSocket Disconnect
        await ws_manager.disconnect(str(session_id), websocket)
        
        # Update connection registers in Redis
        await redis_presence.unregister_connection(str(session_id), connection_id)
        
        async with AsyncSessionLocal() as db_session:
            session_repo = SessionRepository(db_session)
            participant_repo = ParticipantRepository(db_session)
            event_repo = SessionEventRepository(db_session)
            participant_service = ParticipantService(session_repo, event_repo, participant_repo, db_session)
            
            # Fetch latest participant state
            p = await participant_repo.get_by_id(participant_id)
            s = await session_repo.get_by_id(session_id)
            
            if p and p.connection_status != ParticipantConnectionStatus.LEFT and s and s.status != SessionStatus.ENDED:
                # Mark as disconnected in Redis presence
                await redis_presence.update_presence(str(session_id), str(participant_id), "DISCONNECTED")

                # Bug #2 fix: disconnect_participant handles all state changes AND broadcasts
                # (system chat messages + session ABANDONED transition).
                # Do NOT add extra broadcast calls here to avoid duplicate events.
                await participant_service.disconnect_participant(session_id, participant_id)


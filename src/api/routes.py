from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

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
)
from src.api.dependencies import get_session_service, get_participant_service, get_current_identity
from src.services.session_service import SessionService
from src.services.participant_service import ParticipantService

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


@router.post("/{session_id}/participants/join", response_model=ParticipantResponse, status_code=status.HTTP_201_CREATED)
async def join_session(
    session_id: uuid.UUID,
    request: ParticipantJoinRequest,
    identity: Identity = Depends(get_current_identity),
    service: ParticipantService = Depends(get_participant_service),
):
    """Join a session as a participant (Agent or Customer)."""
    try:
        participant = await service.join_session(
            session_id=session_id,
            identity=identity,
            invite_token=request.invite_token,
        )
        return participant
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


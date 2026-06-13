from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

from src.core.exceptions import (
    DomainException,
    SessionNotFound,
    InvalidInvite,
    InvalidStateTransition,
)
from src.core.identity import Identity
from src.api.schemas import (
    SessionCreateRequest,
    SessionResponse,
    ValidateInviteRequest,
    ValidateInviteResponse,
    SessionListResponse,
    SessionEventResponse,
)
from src.api.dependencies import get_session_service, get_current_identity
from src.services.session_service import SessionService

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

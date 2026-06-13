from typing import AsyncGenerator, Optional

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.identity import Identity
from src.infrastructure.database import AsyncSessionLocal
from src.infrastructure.repositories import SessionRepository, SessionEventRepository, ParticipantRepository, ChatMessageRepository
from src.services.session_service import SessionService
from src.services.participant_service import ParticipantService
from src.services.chat_service import ChatService


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency yielding a database session context."""
    async with AsyncSessionLocal() as session:
        yield session


def get_session_service(
    db_session: AsyncSession = Depends(get_db_session),
) -> SessionService:
    """Dependency injecting SessionService, built with required repositories."""
    session_repo = SessionRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    return SessionService(
        session_repo=session_repo,
        event_repo=event_repo,
        db_session=db_session,
    )


def get_participant_service(
    db_session: AsyncSession = Depends(get_db_session),
) -> ParticipantService:
    """Dependency injecting ParticipantService, built with required repositories."""
    session_repo = SessionRepository(db_session)
    event_repo = SessionEventRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    return ParticipantService(
        session_repo=session_repo,
        event_repo=event_repo,
        participant_repo=participant_repo,
        db_session=db_session,
    )


def get_chat_service(
    db_session: AsyncSession = Depends(get_db_session),
) -> ChatService:
    """Dependency injecting ChatService, built with required repositories."""
    session_repo = SessionRepository(db_session)
    participant_repo = ParticipantRepository(db_session)
    message_repo = ChatMessageRepository(db_session)
    return ChatService(
        session_repo=session_repo,
        participant_repo=participant_repo,
        message_repo=message_repo,
        db_session=db_session,
    )


from fastapi import Header, HTTPException, status
from src.core.auth import decode_jwt
from src.core.identity import AuthenticatedIdentity

async def get_current_identity(
    authorization: Optional[str] = Header(None),
) -> AuthenticatedIdentity:
    """Dependency extracting the lightweight Identity from the Authorization header JWT."""
    if not authorization or not authorization.startswith("Bearer "):
        return AuthenticatedIdentity(user_id="anonymous", role="anonymous")

    token = authorization.split(" ")[1]
    payload = decode_jwt(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token"
        )
    user_id = payload.get("sub")
    role = payload.get("role")
    if not user_id or not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token claims"
        )
    return AuthenticatedIdentity(user_id=user_id, role=role.upper())




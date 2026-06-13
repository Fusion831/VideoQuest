from typing import AsyncGenerator, Optional

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.identity import Identity
from src.infrastructure.database import AsyncSessionLocal
from src.infrastructure.repositories import SessionRepository, SessionEventRepository, ParticipantRepository
from src.services.session_service import SessionService
from src.services.participant_service import ParticipantService


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


def get_current_identity(
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
    x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
) -> Identity:
    """Dependency extracting the lightweight Identity from transport headers."""
    user_id = x_user_id or "default_user"
    role = x_user_role or "agent"
    return Identity(user_id=user_id, role=role)



from typing import List, Optional, Tuple
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from src.core.exceptions import (
    DomainException,
    SessionNotFound,
    InvalidInvite,
    InvalidStateTransition,
)
from src.core.identity import Identity
from src.domain.models import DomainSession, SessionStatus
from src.domain.events import DomainSessionEvent, SessionEventType
from src.infrastructure.repositories import SessionRepository, SessionEventRepository


class SessionService:
    def __init__(
        self,
        session_repo: SessionRepository,
        event_repo: SessionEventRepository,
        db_session: AsyncSession,
    ):
        self.session_repo = session_repo
        self.event_repo = event_repo
        self.db_session = db_session

    async def create_session(self, creator: Identity) -> DomainSession:
        """Create a new session and record the SESSION_CREATED event inside a transaction.
        
        Requires an Agent identity.
        """
        if creator.role != "agent":
            raise DomainException("Only agents can create support sessions.")

        try:
            session = DomainSession(agent_id=creator.user_id)
            saved_session = await self.session_repo.save(session)

            # Record creation event
            event = DomainSessionEvent(
                session_id=saved_session.id,
                event_type=SessionEventType.SESSION_CREATED,
                metadata={
                    "agent_id": creator.user_id,
                    "created_by": creator.user_id,
                },
            )
            await self.event_repo.save(event)

            await self.db_session.commit()
            return saved_session
        except Exception:
            await self.db_session.rollback()
            raise

    async def get_session(self, session_id: uuid.UUID) -> DomainSession:
        """Retrieve session by ID, raises SessionNotFound if missing."""
        session = await self.session_repo.get_by_id(session_id)
        if not session:
            raise SessionNotFound(str(session_id))
        return session

    async def validate_invite(self, invite_token: str) -> DomainSession:
        """Validate if an invite token is valid and associated with an active/creatable session."""
        session = await self.session_repo.get_by_invite_token(invite_token)
        if not session:
            raise InvalidInvite(invite_token, "Invite token not found")
        
        if not session.is_invite_valid:
            raise InvalidInvite(invite_token, "Session has already ended")
            
        return session

    async def end_session(self, session_id: uuid.UUID, initiator: Identity) -> DomainSession:
        """Transition session to ENDED status and record SESSION_ENDED event.
        
        This operation is idempotent. If the session has already ended:
        - It does not generate new events or modify the database.
        - It safely returns the current ended session state.
        """
        try:
            session = await self.session_repo.get_by_id(session_id)
            if not session:
                raise SessionNotFound(str(session_id))

            # Perform idempotent state transition
            state_changed = session.end()
            
            if state_changed:
                saved_session = await self.session_repo.save(session)

                # Record ending event (append-only)
                event = DomainSessionEvent(
                    session_id=saved_session.id,
                    event_type=SessionEventType.SESSION_ENDED,
                    metadata={
                        "ended_by": initiator.user_id,
                        "role": initiator.role,
                        "ended_at": saved_session.ended_at.isoformat() if saved_session.ended_at else None
                    },
                )
                await self.event_repo.save(event)
                await self.db_session.commit()
                return saved_session
            
            # If state did not change (already ended), simply return the session without mutations
            return session
        except Exception:
            await self.db_session.rollback()
            raise

    async def list_sessions(
        self, limit: int = 20, offset: int = 0, status: Optional[str] = None
    ) -> Tuple[List[DomainSession], int]:
        """Query historical sessions."""
        return await self.session_repo.list_sessions(limit=limit, offset=offset, status=status)

    async def get_session_events(self, session_id: uuid.UUID) -> List[DomainSessionEvent]:
        """Retrieve all events related to a session."""
        session = await self.session_repo.get_by_id(session_id)
        if not session:
            raise SessionNotFound(str(session_id))
        return await self.event_repo.get_by_session_id(session_id)

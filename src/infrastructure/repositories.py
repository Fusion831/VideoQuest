from typing import Optional, List, Tuple
import uuid
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from src.domain.models import DomainSession, DomainParticipant, DomainChatMessage
from src.domain.events import DomainSessionEvent
from src.infrastructure.models import SessionORM, SessionEventORM, ParticipantORM, ChatMessageORM


class SessionRepository:
    def __init__(self, db_session: AsyncSession):
        self.db_session = db_session

    async def save(self, domain_session: DomainSession) -> DomainSession:
        """Save a session (inserts or updates)."""
        orm_session = SessionORM.from_domain(domain_session)
        merged = await self.db_session.merge(orm_session)
        await self.db_session.flush()  # push to DB within current transaction
        return merged.to_domain()

    async def get_by_id(self, session_id: uuid.UUID) -> Optional[DomainSession]:
        """Retrieve a session by its ID."""
        result = await self.db_session.execute(
            select(SessionORM).where(SessionORM.id == session_id)
        )
        orm_session = result.scalar_one_or_none()
        return orm_session.to_domain() if orm_session else None

    async def get_by_invite_token(self, invite_token: str) -> Optional[DomainSession]:
        """Retrieve a session by its invite token."""
        result = await self.db_session.execute(
            select(SessionORM).where(SessionORM.invite_token == invite_token)
        )
        orm_session = result.scalar_one_or_none()
        return orm_session.to_domain() if orm_session else None

    async def list_sessions(
        self, limit: int = 20, offset: int = 0, status: Optional[str] = None
    ) -> Tuple[List[DomainSession], int]:
        """Retrieve a list of sessions, filtered by status, and return total count."""
        # Query total count
        count_stmt = select(func.count(SessionORM.id))
        if status:
            count_stmt = count_stmt.where(SessionORM.status == status)
        count_result = await self.db_session.execute(count_stmt)
        total = count_result.scalar_one()

        # Query list
        list_stmt = select(SessionORM)
        if status:
            list_stmt = list_stmt.where(SessionORM.status == status)
        list_stmt = list_stmt.order_by(SessionORM.created_at.desc()).offset(offset).limit(limit)
        
        list_result = await self.db_session.execute(list_stmt)
        orm_sessions = list_result.scalars().all()
        
        return [orm.to_domain() for orm in orm_sessions], total


class SessionEventRepository:
    def __init__(self, db_session: AsyncSession):
        self.db_session = db_session

    async def save(self, domain_event: DomainSessionEvent) -> DomainSessionEvent:
        """Save a session event."""
        orm_event = SessionEventORM.from_domain(domain_event)
        self.db_session.add(orm_event)
        await self.db_session.flush()
        return orm_event.to_domain()

    async def get_by_session_id(self, session_id: uuid.UUID) -> List[DomainSessionEvent]:
        """Retrieve all events for a given session, ordered by timestamp ascending."""
        result = await self.db_session.execute(
            select(SessionEventORM)
            .where(SessionEventORM.session_id == session_id)
            .order_by(SessionEventORM.timestamp.asc())
        )
        orm_events = result.scalars().all()
        return [orm.to_domain() for orm in orm_events]


class ParticipantRepository:
    def __init__(self, db_session: AsyncSession):
        self.db_session = db_session

    async def save(self, domain_participant: DomainParticipant) -> DomainParticipant:
        """Save a participant (inserts or updates)."""
        orm_participant = ParticipantORM.from_domain(domain_participant)
        merged = await self.db_session.merge(orm_participant)
        await self.db_session.flush()
        return merged.to_domain()

    async def get_by_id(self, participant_id: uuid.UUID) -> Optional[DomainParticipant]:
        """Retrieve a participant by their ID."""
        result = await self.db_session.execute(
            select(ParticipantORM).where(ParticipantORM.id == participant_id)
        )
        orm_participant = result.scalar_one_or_none()
        return orm_participant.to_domain() if orm_participant else None

    async def get_by_session_id(self, session_id: uuid.UUID) -> List[DomainParticipant]:
        """Retrieve all participants for a session."""
        result = await self.db_session.execute(
            select(ParticipantORM)
            .where(ParticipantORM.session_id == session_id)
            .order_by(ParticipantORM.joined_at.asc())
        )
        orm_participants = result.scalars().all()
        return [orm.to_domain() for orm in orm_participants]

    async def get_by_session_and_role(self, session_id: uuid.UUID, role: str) -> Optional[DomainParticipant]:
        """Retrieve a participant by session and role (at most one per role)."""
        result = await self.db_session.execute(
            select(ParticipantORM)
            .where(ParticipantORM.session_id == session_id)
            .where(ParticipantORM.role == role)
        )
        orm_participant = result.scalar_one_or_none()
        return orm_participant.to_domain() if orm_participant else None


class ChatMessageRepository:
    def __init__(self, db_session: AsyncSession):
        self.db_session = db_session

    async def save(self, domain_message: DomainChatMessage) -> DomainChatMessage:
        """Save a chat message."""
        orm_message = ChatMessageORM.from_domain(domain_message)
        self.db_session.add(orm_message)
        await self.db_session.flush()
        return orm_message.to_domain()

    async def get_by_session_id(
        self, session_id: uuid.UUID, limit: int = 100, offset: int = 0
    ) -> List[DomainChatMessage]:
        """Retrieve historical messages for a session, chronologically."""
        result = await self.db_session.execute(
            select(ChatMessageORM)
            .where(ChatMessageORM.session_id == session_id)
            .order_by(ChatMessageORM.created_at.asc())
            .offset(offset)
            .limit(limit)
        )
        orm_messages = result.scalars().all()
        return [orm.to_domain() for orm in orm_messages]


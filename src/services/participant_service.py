from typing import List, Optional
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from src.core.exceptions import (
    DomainException,
    SessionNotFound,
    SessionAlreadyEnded,
    InvalidInvite,
    ParticipantNotFound,
    ParticipantAlreadyJoined,
    ParticipantAlreadyLeft,
    InvalidConnectionTransition,
)
from src.core.identity import Identity
from src.domain.models import (
    DomainSession,
    SessionStatus,
    DomainParticipant,
    ParticipantRole,
    ParticipantConnectionStatus,
)
from src.domain.events import DomainSessionEvent, SessionEventType
from src.infrastructure.repositories import (
    SessionRepository,
    SessionEventRepository,
    ParticipantRepository,
)


class ParticipantService:
    def __init__(
        self,
        session_repo: SessionRepository,
        event_repo: SessionEventRepository,
        participant_repo: ParticipantRepository,
        db_session: AsyncSession,
    ):
        self.session_repo = session_repo
        self.event_repo = event_repo
        self.participant_repo = participant_repo
        self.db_session = db_session

    async def join_session(
        self,
        session_id: uuid.UUID,
        identity: Identity,
        invite_token: Optional[str] = None,
    ) -> DomainParticipant:
        """Add a participant to the session.
        
        Validates:
        - Session exists and is not ended.
        - Agent user matches the session's assigned agent.
        - Customer provides the correct invite token.
        
        Handles duplicate joins and browser refreshes:
        - If already CONNECTED, returns existing participant.
        - If DISCONNECTED, reconnects the participant and generates RECONNECTED event.
        - If LEFT, raises ParticipantAlreadyLeft.
        
        Session Activation:
        - Automatically transitions the session to ACTIVE if it is the first participant.
        
        All database operations are transactional.
        """
        try:
            # 1. Validate Session
            session = await self.session_repo.get_by_id(session_id)
            if not session:
                raise SessionNotFound(str(session_id))
            
            if session.status == SessionStatus.ENDED:
                raise SessionAlreadyEnded(str(session_id))

            # 2. Validate Identity and invite
            role_val = identity.role.upper()
            if role_val not in (ParticipantRole.AGENT, ParticipantRole.CUSTOMER):
                raise DomainException(f"Unsupported participant role: {identity.role}")

            role = ParticipantRole(role_val)

            if role == ParticipantRole.AGENT:
                if identity.user_id != session.agent_id:
                    raise DomainException("Only the assigned agent can join this session.")
            elif role == ParticipantRole.CUSTOMER:
                if not invite_token or invite_token != session.invite_token:
                    raise InvalidInvite(invite_token or "", "Invalid or missing invite token")

            # 3. Check for existing participant record
            existing = await self.participant_repo.get_by_session_and_role(session_id, role.value)
            if existing:
                if existing.user_id != identity.user_id:
                    raise ParticipantAlreadyJoined(str(session_id), role.value)

                if existing.connection_status == ParticipantConnectionStatus.CONNECTED:
                    # Graceful duplicate join handling
                    return existing
                elif existing.connection_status == ParticipantConnectionStatus.DISCONNECTED:
                    # Browser refresh / reconnect during join
                    existing.reconnect()
                    saved_participant = await self.participant_repo.save(existing)
                    
                    event = DomainSessionEvent(
                        session_id=session_id,
                        event_type=SessionEventType.PARTICIPANT_RECONNECTED,
                        metadata={
                            "participant_id": str(saved_participant.id),
                            "role": saved_participant.role.value,
                            "user_id": saved_participant.user_id,
                            "via_join": True,
                        },
                    )
                    await self.event_repo.save(event)
                    await self.db_session.commit()
                    return saved_participant
                elif existing.connection_status == ParticipantConnectionStatus.LEFT:
                    raise ParticipantAlreadyLeft(str(existing.id))

            # 4. Create new participant
            participant = DomainParticipant(
                session_id=session_id,
                role=role,
                user_id=identity.user_id,
                connection_status=ParticipantConnectionStatus.CONNECTED,
            )
            saved_participant = await self.participant_repo.save(participant)

            # 5. Record join event
            join_event = DomainSessionEvent(
                session_id=session_id,
                event_type=SessionEventType.PARTICIPANT_JOINED,
                metadata={
                    "participant_id": str(saved_participant.id),
                    "role": saved_participant.role.value,
                    "user_id": saved_participant.user_id,
                },
            )
            await self.event_repo.save(join_event)

            # 6. Automatic Session Activation
            if session.status == SessionStatus.CREATED:
                session.activate()
                await self.session_repo.save(session)
                
                activation_event = DomainSessionEvent(
                    session_id=session_id,
                    event_type=SessionEventType.SESSION_STARTED,
                    metadata={
                        "activated_by_participant_id": str(saved_participant.id),
                        "activated_by_role": saved_participant.role.value,
                        "activated_by_user": saved_participant.user_id,
                    },
                )
                await self.event_repo.save(activation_event)

            await self.db_session.commit()
            return saved_participant

        except Exception:
            await self.db_session.rollback()
            raise

    async def leave_session(self, session_id: uuid.UUID, participant_id: uuid.UUID) -> DomainParticipant:
        """Mark participant as LEFT (idempotent state transition).
        
        Repeated calls return the left state without generating new events or mutating the DB.
        """
        try:
            participant = await self.participant_repo.get_by_id(participant_id)
            if not participant or participant.session_id != session_id:
                raise ParticipantNotFound(str(participant_id))

            state_changed = participant.leave()
            if state_changed:
                saved_participant = await self.participant_repo.save(participant)
                
                event = DomainSessionEvent(
                    session_id=session_id,
                    event_type=SessionEventType.PARTICIPANT_LEFT,
                    metadata={
                        "participant_id": str(saved_participant.id),
                        "role": saved_participant.role.value,
                        "user_id": saved_participant.user_id,
                        "left_at": saved_participant.left_at.isoformat() if saved_participant.left_at else None,
                    },
                )
                await self.event_repo.save(event)

                # Transition session to ENDED when a participant leaves
                session = await self.session_repo.get_by_id(session_id)
                if session and session.status != SessionStatus.ENDED:
                    session.end()
                    await self.session_repo.save(session)
                    
                    end_event = DomainSessionEvent(
                        session_id=session_id,
                        event_type=SessionEventType.SESSION_ENDED,
                        metadata={
                            "ended_by": saved_participant.user_id,
                            "role": saved_participant.role.value,
                            "reason": "Participant left the session",
                        },
                    )
                    await self.event_repo.save(end_event)
                    
                    # Mark all other participants as LEFT too
                    all_participants = await self.participant_repo.get_by_session_id(session_id)
                    for p in all_participants:
                        if p.id != participant_id and p.connection_status != ParticipantConnectionStatus.LEFT:
                            p.leave()
                            await self.participant_repo.save(p)
                            
                            p_left_event = DomainSessionEvent(
                                session_id=session_id,
                                event_type=SessionEventType.PARTICIPANT_LEFT,
                                metadata={
                                    "participant_id": str(p.id),
                                    "role": p.role.value,
                                    "user_id": p.user_id,
                                    "left_at": p.left_at.isoformat() if p.left_at else None,
                                    "reason": f"Session ended because {saved_participant.user_id} left",
                                },
                            )
                            await self.event_repo.save(p_left_event)

                await self.db_session.commit()
                return saved_participant

            return participant
        except Exception:
            await self.db_session.rollback()
            raise

    async def disconnect_participant(self, session_id: uuid.UUID, participant_id: uuid.UUID) -> DomainParticipant:
        """Mark participant as DISCONNECTED (idempotent transition)."""
        try:
            participant = await self.participant_repo.get_by_id(participant_id)
            if not participant or participant.session_id != session_id:
                raise ParticipantNotFound(str(participant_id))

            state_changed = participant.disconnect()
            if state_changed:
                saved_participant = await self.participant_repo.save(participant)
                
                event = DomainSessionEvent(
                    session_id=session_id,
                    event_type=SessionEventType.PARTICIPANT_DISCONNECTED,
                    metadata={
                        "participant_id": str(saved_participant.id),
                        "role": saved_participant.role.value,
                        "user_id": saved_participant.user_id,
                    },
                )
                await self.event_repo.save(event)
                await self.db_session.commit()
                return saved_participant

            return participant
        except Exception:
            await self.db_session.rollback()
            raise

    async def reconnect_participant(self, session_id: uuid.UUID, participant_id: uuid.UUID) -> DomainParticipant:
        """Restore participant to CONNECTED from DISCONNECTED state."""
        try:
            # Validate session exists and not ended
            session = await self.session_repo.get_by_id(session_id)
            if not session:
                raise SessionNotFound(str(session_id))
            if session.status == SessionStatus.ENDED:
                raise SessionAlreadyEnded(str(session_id))

            participant = await self.participant_repo.get_by_id(participant_id)
            if not participant or participant.session_id != session_id:
                raise ParticipantNotFound(str(participant_id))

            state_changed = participant.reconnect()
            if state_changed:
                saved_participant = await self.participant_repo.save(participant)
                
                event = DomainSessionEvent(
                    session_id=session_id,
                    event_type=SessionEventType.PARTICIPANT_RECONNECTED,
                    metadata={
                        "participant_id": str(saved_participant.id),
                        "role": saved_participant.role.value,
                        "user_id": saved_participant.user_id,
                    },
                )
                await self.event_repo.save(event)
                await self.db_session.commit()
                return saved_participant

            return participant
        except Exception:
            await self.db_session.rollback()
            raise

    async def get_session_participants(self, session_id: uuid.UUID) -> List[DomainParticipant]:
        """Retrieve all participants currently registered in the session."""
        session = await self.session_repo.get_by_id(session_id)
        if not session:
            raise SessionNotFound(str(session_id))
        return await self.participant_repo.get_by_session_id(session_id)

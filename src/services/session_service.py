from typing import List, Optional, Tuple
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from src.core.exceptions import (
    DomainException,
    SessionNotFound,
    InvalidInvite,
    InvalidStateTransition,
    PermissionDenied,
)
from src.core.identity import Identity, Permission
from src.domain.models import DomainSession, SessionStatus, ParticipantConnectionStatus
from src.domain.events import DomainSessionEvent, SessionEventType
from src.infrastructure.repositories import SessionRepository, SessionEventRepository, ParticipantRepository



class SessionService:
    def __init__(
        self,
        session_repo: SessionRepository,
        event_repo: SessionEventRepository,
        db_session: AsyncSession,
        participant_repo: Optional[ParticipantRepository] = None,
    ):
        self.session_repo = session_repo
        self.event_repo = event_repo
        self.db_session = db_session
        self.participant_repo = participant_repo or ParticipantRepository(db_session)


    async def create_session(self, creator: Identity) -> DomainSession:
        """Create a new session and record the SESSION_CREATED event inside a transaction.
        
        Requires an Agent identity.
        """
        if not creator.has_permission(Permission.CREATE_SESSION):
            raise PermissionDenied("Only agents can create support sessions.")


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

    async def create_support_request(self, customer_name: str, issue_description: str) -> DomainSession:
        """Create a new support request session without an assigned agent."""
        try:
            session = DomainSession(
                agent_id=None,
                status=SessionStatus.CREATED,
                customer_name=customer_name,
                issue_description=issue_description
            )
            saved_session = await self.session_repo.save(session)

            # Record creation event
            event = DomainSessionEvent(
                session_id=saved_session.id,
                event_type=SessionEventType.SESSION_CREATED,
                metadata={
                    "customer_name": customer_name,
                    "issue_description": issue_description,
                },
            )
            await self.event_repo.save(event)

            await self.db_session.commit()
            return saved_session
        except Exception:
            await self.db_session.rollback()
            raise

    async def accept_support_request(self, session_id: uuid.UUID, agent_id: str) -> DomainSession:
        """Assign agent to a pending support session and transition to ACTIVE."""
        try:
            session = await self.session_repo.get_by_id(session_id)
            if not session:
                raise SessionNotFound(str(session_id))
            
            # Idempotently transition to ACTIVE and assign agent
            session.agent_id = agent_id
            session.activate() # transitions status to ACTIVE and updates started_at / updated_at
            
            saved_session = await self.session_repo.save(session)

            # Record accept/activation event
            event = DomainSessionEvent(
                session_id=saved_session.id,
                event_type=SessionEventType.SESSION_STARTED,
                metadata={
                    "agent_id": agent_id,
                },
            )
            await self.event_repo.save(event)

            # Flush system message that the agent accepted
            from src.services.chat_service import flush_system_message, broadcast_system_message_payload
            payload = await flush_system_message(self.db_session, session_id, f"Support agent {agent_id} joined the session.")
            
            await self.db_session.commit()

            # Broadcast system chat event to WebSocket
            await broadcast_system_message_payload(session_id, payload)

            return saved_session
        except Exception:
            await self.db_session.rollback()
            raise

    async def request_video(self, session_id: uuid.UUID, agent_id: str) -> DomainSession:
        try:
            session = await self.session_repo.get_by_id(session_id)
            if not session:
                raise SessionNotFound(str(session_id))
            
            if session.agent_id != agent_id:
                raise PermissionDenied("Only the assigned agent can start a video call.")

            session.video_escalation_status = "REQUESTED"
            saved_session = await self.session_repo.save(session)
            
            # Save system chat message about video request
            from src.services.chat_service import flush_system_message, broadcast_system_message_payload
            payload = await flush_system_message(
                self.db_session, session_id,
                "Support agent has requested to start a video call.",
                metadata={"type": "VIDEO_REQUESTED"}
            )
            await self.db_session.commit()
            
            await broadcast_system_message_payload(session_id, payload)
            return saved_session
        except Exception:
            await self.db_session.rollback()
            raise

    async def accept_video(self, session_id: uuid.UUID, customer_name: str) -> DomainSession:
        try:
            session = await self.session_repo.get_by_id(session_id)
            if not session:
                raise SessionNotFound(str(session_id))
            
            session.video_escalation_status = "ACTIVE"
            saved_session = await self.session_repo.save(session)
            
            # Save system chat message about video accepted
            from src.services.chat_service import flush_system_message, broadcast_system_message_payload
            payload = await flush_system_message(
                self.db_session, session_id,
                "Video call has started.",
                metadata={"type": "VIDEO_ACTIVE"}
            )
            await self.db_session.commit()
            
            await broadcast_system_message_payload(session_id, payload)
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
        
        from datetime import datetime, timezone, timedelta
        if datetime.now(timezone.utc) - session.created_at > timedelta(hours=24):
            raise InvalidInvite(invite_token, "Invite token has expired")

        if not session.is_invite_valid:
            raise InvalidInvite(invite_token, "Session has already ended")
            
        return session

    async def end_session(self, session_id: uuid.UUID, initiator: Identity) -> DomainSession:
        """Transition session to ENDED status and record SESSION_ENDED event.

        This operation is idempotent. If the session has already ended:
        - It does not generate new events or modify the database.
        - It safely returns the current ended session state.
        """
        from src.services.chat_service import flush_system_message, broadcast_system_message_payload
        pending_broadcasts: list[tuple[uuid.UUID, dict]] = []

        try:
            session = await self.session_repo.get_by_id(session_id)
            if not session:

                raise SessionNotFound(str(session_id))

            if not initiator.has_permission(Permission.END_SESSION):
                raise PermissionDenied("Only agents can end support sessions.")

            if not initiator.user_id.startswith("system_") and session.agent_id != initiator.user_id:
                raise PermissionDenied("Only the assigned agent can end this support session.")



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
                        "ended_at": saved_session.ended_at.isoformat() if saved_session.ended_at else None,
                    },
                )
                await self.event_repo.save(event)

                # Bug #1 fix: flush message within transaction, broadcast after commit
                payload = await flush_system_message(self.db_session, session_id, "Support session ended")
                pending_broadcasts.append((session_id, payload))

                # Transition all active participants to LEFT
                participants = await self.participant_repo.get_by_session_id(session_id)
                for p in participants:
                    if p.connection_status != ParticipantConnectionStatus.LEFT:
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
                                "reason": f"Session ended by {initiator.user_id}",
                            },
                        )
                        await self.event_repo.save(p_left_event)
                        p_payload = await flush_system_message(
                            self.db_session, session_id,
                            f"{p.role.value.title()} {p.user_id} left the session"
                        )
                        pending_broadcasts.append((session_id, p_payload))

                await self.db_session.commit()

                # Clean up the LiveKit room after successful DB commit
                try:
                    from src.services.livekit_service import LiveKitService
                    livekit_service = LiveKitService()
                    await livekit_service.delete_room(str(session_id))
                except Exception:
                    pass

                # Bug #1 fix: broadcast AFTER commit
                for sid, p in pending_broadcasts:
                    await broadcast_system_message_payload(sid, p)
                return saved_session

            # If state did not change (already ended), simply return the session without mutations
            return session
        except Exception:
            await self.db_session.rollback()
            raise

    async def list_sessions(
        self, limit: int = 20, offset: int = 0, status: Optional[str] = None, unassigned: Optional[bool] = None
    ) -> Tuple[List[DomainSession], int]:
        """Query historical sessions."""
        return await self.session_repo.list_sessions(limit=limit, offset=offset, status=status, unassigned=unassigned)

    async def get_session_events(self, session_id: uuid.UUID, initiator: Identity) -> List[DomainSessionEvent]:
        """Retrieve all events related to a session."""
        if not initiator.has_permission(Permission.VIEW_DIAGNOSTICS):
            raise PermissionDenied("Only agents can view diagnostics.")
        session = await self.session_repo.get_by_id(session_id)
        if not session:
            raise SessionNotFound(str(session_id))
        return await self.event_repo.get_by_session_id(session_id)


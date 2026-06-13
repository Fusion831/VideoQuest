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
    PermissionDenied,
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
from src.infrastructure.redis import RedisPresenceService


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
        - Automatically transitions the session to ACTIVE if it was CREATED or ABANDONED.

        All database operations are transactional. Broadcasts fire after commit.
        """
        from src.services.chat_service import flush_system_message, broadcast_system_message_payload
        pending_broadcasts: list[tuple[uuid.UUID, dict]] = []

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
                    # Graceful duplicate join — idempotent
                    return existing
                elif existing.connection_status == ParticipantConnectionStatus.DISCONNECTED:
                    # Browser refresh / reconnect via join
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
                    payload = await flush_system_message(
                        self.db_session, session_id,
                        f"{saved_participant.role.value.title()} {saved_participant.user_id} reconnected"
                    )
                    pending_broadcasts.append((session_id, payload))

                    # If session was ABANDONED, re-activate it
                    if session.status == SessionStatus.ABANDONED:
                        session.activate()
                        await self.session_repo.save(session)
                        activation_event = DomainSessionEvent(
                            session_id=session_id,
                            event_type=SessionEventType.SESSION_STARTED,
                            metadata={
                                "reconnected_participant_id": str(saved_participant.id),
                                "reason": "Participant reconnected via join to abandoned session",
                            },
                        )
                        await self.event_repo.save(activation_event)
                        payload2 = await flush_system_message(self.db_session, session_id, "Support session resumed")
                        pending_broadcasts.append((session_id, payload2))
                        redis_presence = RedisPresenceService()
                        await redis_presence.clear_abandonment_expiry(str(session_id))

                    await self.db_session.commit()
                    for sid, p in pending_broadcasts:
                        await broadcast_system_message_payload(sid, p)
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
            payload = await flush_system_message(
                self.db_session, session_id,
                f"{saved_participant.role.value.title()} {saved_participant.user_id} joined the session"
            )
            pending_broadcasts.append((session_id, payload))

            # 6. Automatic Session Activation (CREATED or ABANDONED → ACTIVE)
            if session.status in (SessionStatus.CREATED, SessionStatus.ABANDONED):
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
                payload2 = await flush_system_message(self.db_session, session_id, "Support session started")
                pending_broadcasts.append((session_id, payload2))

                if session.status == SessionStatus.ABANDONED:
                    redis_presence = RedisPresenceService()
                    await redis_presence.clear_abandonment_expiry(str(session_id))

            await self.db_session.commit()
            # Bug #1 fix: broadcast AFTER commit
            for sid, p in pending_broadcasts:
                await broadcast_system_message_payload(sid, p)
            return saved_participant

        except Exception:
            await self.db_session.rollback()
            raise

    async def leave_session(self, session_id: uuid.UUID, participant_id: uuid.UUID) -> DomainParticipant:
        """Mark participant as LEFT (idempotent state transition).

        Repeated calls return the left state without generating new events or mutating the DB.
        """
        from src.services.chat_service import flush_system_message, broadcast_system_message_payload
        pending_broadcasts: list[tuple[uuid.UUID, dict]] = []

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

                payload = await flush_system_message(
                    self.db_session, session_id,
                    f"{saved_participant.role.value.title()} {saved_participant.user_id} left the session"
                )
                pending_broadcasts.append((session_id, payload))

                # Mark the participant as LEFT in Redis presence immediately
                redis_presence = RedisPresenceService()
                await redis_presence.update_presence(str(session_id), str(participant_id), "LEFT")

                # Transition session to ABANDONED when a participant leaves and no connected participants remain
                session = await self.session_repo.get_by_id(session_id)
                if session:
                    all_participants = await self.participant_repo.get_by_session_id(session_id)
                    any_connected = any(p.connection_status == ParticipantConnectionStatus.CONNECTED for p in all_participants)

                    if not any_connected and session.status == SessionStatus.ACTIVE:
                        session.abandon()
                        await self.session_repo.save(session)

                        abandon_event = DomainSessionEvent(
                            session_id=session_id,
                            event_type=SessionEventType.SESSION_ABANDONED,
                            metadata={
                                "disconnected_participant_id": str(saved_participant.id),
                                "reason": "All participants left or disconnected",
                            },
                        )
                        await self.event_repo.save(abandon_event)
                        payload2 = await flush_system_message(
                            self.db_session, session_id,
                            "Support session abandoned — waiting for reconnect"
                        )
                        pending_broadcasts.append((session_id, payload2))

                        # Set abandonment window in Redis (60s grace period)
                        await redis_presence.set_abandonment_expiry(str(session_id), ttl_seconds=60)

                await self.db_session.commit()
                # Bug #1 fix: broadcast AFTER commit
                for sid, p in pending_broadcasts:
                    await broadcast_system_message_payload(sid, p)
                return saved_participant

            return participant
        except Exception:
            await self.db_session.rollback()
            raise

    async def disconnect_participant(self, session_id: uuid.UUID, participant_id: uuid.UUID) -> DomainParticipant:
        """Mark participant as DISCONNECTED (idempotent transition)."""
        from src.services.chat_service import flush_system_message, broadcast_system_message_payload
        pending_broadcasts: list[tuple[uuid.UUID, dict]] = []

        try:
            session = await self.session_repo.get_by_id(session_id)
            if not session:
                raise SessionNotFound(str(session_id))
            if session.status == SessionStatus.ENDED:
                raise SessionAlreadyEnded(str(session_id))

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

                payload = await flush_system_message(
                    self.db_session, session_id,
                    f"{saved_participant.role.value.title()} {saved_participant.user_id} disconnected"
                )
                pending_broadcasts.append((session_id, payload))

                # Check if all participants in the session are now disconnected or left
                all_participants = await self.participant_repo.get_by_session_id(session_id)
                any_connected = any(p.connection_status == ParticipantConnectionStatus.CONNECTED for p in all_participants)

                if not any_connected and session.status == SessionStatus.ACTIVE:
                    # Transition session to ABANDONED
                    session.abandon()
                    await self.session_repo.save(session)

                    abandon_event = DomainSessionEvent(
                        session_id=session_id,
                        event_type=SessionEventType.SESSION_ABANDONED,
                        metadata={
                            "disconnected_participant_id": str(saved_participant.id),
                            "reason": "All participants disconnected",
                        },
                    )
                    await self.event_repo.save(abandon_event)
                    payload2 = await flush_system_message(self.db_session, session_id, "Support session abandoned — waiting for reconnect")
                    pending_broadcasts.append((session_id, payload2))

                    # Set abandonment window in Redis (60s grace period)
                    redis_presence = RedisPresenceService()
                    await redis_presence.set_abandonment_expiry(str(session_id), ttl_seconds=60)

                await self.db_session.commit()
                # Bug #1 fix: broadcast AFTER commit
                for sid, p in pending_broadcasts:
                    await broadcast_system_message_payload(sid, p)
                return saved_participant

            return participant
        except Exception:
            await self.db_session.rollback()
            raise

    async def reconnect_participant(self, session_id: uuid.UUID, participant_id: uuid.UUID) -> DomainParticipant:
        """Restore participant to CONNECTED from DISCONNECTED state."""
        from src.services.chat_service import flush_system_message, broadcast_system_message_payload
        pending_broadcasts: list[tuple[uuid.UUID, dict]] = []

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

                payload = await flush_system_message(
                    self.db_session, session_id,
                    f"{saved_participant.role.value.title()} {saved_participant.user_id} reconnected"
                )
                pending_broadcasts.append((session_id, payload))

                # Transition session back to ACTIVE if it was ABANDONED
                if session.status == SessionStatus.ABANDONED:
                    session.activate()
                    await self.session_repo.save(session)

                    activation_event = DomainSessionEvent(
                        session_id=session_id,
                        event_type=SessionEventType.SESSION_STARTED,
                        metadata={
                            "reconnected_participant_id": str(saved_participant.id),
                            "reason": "Participant reconnected to abandoned session",
                        },
                    )
                    await self.event_repo.save(activation_event)
                    payload2 = await flush_system_message(self.db_session, session_id, "Support session resumed")
                    pending_broadcasts.append((session_id, payload2))

                    # Clear abandonment from Redis
                    redis_presence = RedisPresenceService()
                    await redis_presence.clear_abandonment_expiry(str(session_id))

                await self.db_session.commit()
                # Bug #1 fix: broadcast AFTER commit
                for sid, p in pending_broadcasts:
                    await broadcast_system_message_payload(sid, p)
                return saved_participant

            return participant
        except Exception:
            await self.db_session.rollback()
            raise

    async def get_session_participants(self, session_id: uuid.UUID, initiator: Identity) -> List[DomainParticipant]:
        """Retrieve all participants currently registered in the session."""
        try:
            ParticipantRole(initiator.role.upper())
        except ValueError:
            raise PermissionDenied("Unauthorized role to view participants.")
        session = await self.session_repo.get_by_id(session_id)
        if not session:
            raise SessionNotFound(str(session_id))
        return await self.participant_repo.get_by_session_id(session_id)


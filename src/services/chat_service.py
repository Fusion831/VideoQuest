import uuid
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from src.domain.models import DomainChatMessage, ChatMessageType, SessionStatus, ParticipantConnectionStatus
from src.core.exceptions import SessionNotFound, SessionAlreadyEnded, ParticipantNotFound, ParticipantAlreadyLeft, PermissionDenied
from src.core.identity import Identity, Permission, ParticipantRole
from src.infrastructure.repositories import SessionRepository, ParticipantRepository, ChatMessageRepository



class ChatService:
    def __init__(
        self,
        session_repo: SessionRepository,
        participant_repo: ParticipantRepository,
        message_repo: ChatMessageRepository,
        db_session: AsyncSession,
    ):
        self.session_repo = session_repo
        self.participant_repo = participant_repo
        self.message_repo = message_repo
        self.db_session = db_session

    async def create_message(
        self,
        session_id: uuid.UUID,
        content: str,
        initiator: Identity,
        sender_participant_id: Optional[uuid.UUID] = None,
        message_type: ChatMessageType = ChatMessageType.USER,
        metadata: Optional[dict] = None,
    ) -> DomainChatMessage:
        """Create and persist a new chat message after validating session and participant status."""
        try:
            # 0. Check permissions
            if not initiator.has_permission(Permission.SEND_MESSAGE):
                raise PermissionDenied("Permission denied to send message.")

            # 1. Validate session
            session = await self.session_repo.get_by_id(session_id)
            if not session:
                raise SessionNotFound(str(session_id))
            # Bug #6 fix: ENDED and ABANDONED sessions are both read-only for chat
            if session.status in (SessionStatus.ENDED, SessionStatus.ABANDONED):
                raise SessionAlreadyEnded(str(session_id))


            # 2. Validate participant (only for user/agent messages)
            if sender_participant_id is not None:
                participant = await self.participant_repo.get_by_id(sender_participant_id)
                if not participant or participant.session_id != session_id:
                    raise ParticipantNotFound(str(sender_participant_id))
                if participant.connection_status == ParticipantConnectionStatus.LEFT:
                    raise ParticipantAlreadyLeft(str(sender_participant_id))
                
                # Verify identity ownership
                if participant.user_id != initiator.user_id or participant.role.value != initiator.role.upper():
                    raise PermissionDenied("Cannot send message as another participant.")


            # 3. Create and save message
            message = DomainChatMessage(
                session_id=session_id,
                content=content,
                sender_participant_id=sender_participant_id,
                message_type=message_type,
                metadata=metadata,
            )
            saved = await self.message_repo.save(message)
            await self.db_session.commit()
            return saved
        except Exception:
            await self.db_session.rollback()
            raise

    async def get_messages(
        self, session_id: uuid.UUID, initiator: Identity, limit: int = 100, offset: int = 0
    ) -> List[DomainChatMessage]:
        """Retrieve historical messages for a session, chronologically."""
        try:
            ParticipantRole(initiator.role.upper())
        except ValueError:
            raise PermissionDenied("Unauthorized role to view messages.")
        # Validate session exists
        session = await self.session_repo.get_by_id(session_id)
        if not session:
            raise SessionNotFound(str(session_id))
        return await self.message_repo.get_by_session_id(session_id, limit=limit, offset=offset)



async def flush_system_message(db_session, session_id: uuid.UUID, content: str, metadata: Optional[dict] = None) -> dict:
    """Flush a SYSTEM chat message within the current open transaction.
    
    Returns the broadcast payload. The caller MUST fire broadcast_system_message_payload()
    AFTER committing the transaction to preserve persist-before-broadcast guarantees.
    """
    msg_repo = ChatMessageRepository(db_session)
    msg = DomainChatMessage(
        session_id=session_id,
        content=content,
        message_type=ChatMessageType.SYSTEM,
        metadata=metadata,
    )
    saved = await msg_repo.save(msg)  # flush only, no commit
    return {
        "id": str(saved.id),
        "session_id": str(saved.session_id),
        "sender_participant_id": None,
        "message_type": saved.message_type.value,
        "content": saved.content,
        "metadata": saved.metadata,
        "created_at": saved.created_at.isoformat(),
    }


async def broadcast_system_message_payload(session_id: uuid.UUID, payload: dict):
    """Broadcast a previously flushed system message payload to websocket clients.
    
    Must only be called AFTER the database transaction has been committed.
    """
    from src.infrastructure.websocket_manager import ws_manager
    await ws_manager.broadcast_to_session(str(session_id), "MESSAGE_RECEIVED", payload)


# ---------------------------------------------------------------------------
# Backwards-compatible helper kept for lifecycle_monitor and legacy callers.
# NEW CODE should use flush_system_message() + broadcast_system_message_payload().
# ---------------------------------------------------------------------------
async def save_and_broadcast_system_message(db_session, session_id: uuid.UUID, content: str) -> DomainChatMessage:
    """Persist a SYSTEM message and broadcast it.
    
    NOTE: This flushes within the caller's open transaction and broadcasts immediately.
    The broadcast fires before commit — callers must accept this tradeoff or use
    flush_system_message() + broadcast_system_message_payload() instead.
    """
    msg_repo = ChatMessageRepository(db_session)
    msg = DomainChatMessage(
        session_id=session_id,
        content=content,
        message_type=ChatMessageType.SYSTEM,
    )
    saved = await msg_repo.save(msg)

    from src.infrastructure.websocket_manager import ws_manager
    await ws_manager.broadcast_to_session(
        str(session_id),
        "MESSAGE_RECEIVED",
        {
            "id": str(saved.id),
            "session_id": str(saved.session_id),
            "sender_participant_id": None,
            "message_type": saved.message_type.value,
            "content": saved.content,
            "metadata": saved.metadata,
            "created_at": saved.created_at.isoformat(),
        }
    )
    return saved


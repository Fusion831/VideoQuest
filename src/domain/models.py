from datetime import datetime, timezone
from enum import Enum
import secrets
from typing import Optional
import uuid

from src.core.exceptions import InvalidStateTransition, InvalidConnectionTransition


class SessionStatus(str, Enum):
    CREATED = "CREATED"
    ACTIVE = "ACTIVE"
    ENDED = "ENDED"


class DomainSession:
    def __init__(
        self,
        agent_id: str,
        id: Optional[uuid.UUID] = None,
        invite_token: Optional[str] = None,
        status: Optional[SessionStatus] = None,
        created_at: Optional[datetime] = None,
        started_at: Optional[datetime] = None,
        ended_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
    ):
        # UUID STRATEGY DOCUMENTATION:
        # We use standard UUIDv4 (uuid.uuid4()) as our globally unique, non-sequential identifier.
        # UUIDv7 is preferred but not natively supported in the standard python uuid library before Python 3.14.
        # To avoid introducing speculative third-party dependencies during the hackathon,
        # UUIDv4 is used as the most pragmatic, tooling-compatible choice that satisfies all requirements.
        self.id = id or uuid.uuid4()
        self.invite_token = invite_token or self._generate_invite_token()
        self.status = status or SessionStatus.CREATED
        self.agent_id = agent_id
        
        now = datetime.now(timezone.utc)
        self.created_at = created_at or now
        self.started_at = started_at
        self.ended_at = ended_at
        self.updated_at = updated_at or now

    @staticmethod
    def _generate_invite_token() -> str:
        # Cryptographically secure invite token
        return secrets.token_urlsafe(32)

    def activate(self) -> bool:
        """Transition the session from CREATED to ACTIVE.
        
        This method is idempotent:
        - If already ACTIVE, it returns False and performs no changes.
        - Otherwise, it transitions the status to ACTIVE, sets started_at, and returns True.
        """
        if self.status == SessionStatus.ACTIVE:
            return False
            
        if self.status != SessionStatus.CREATED:
            raise InvalidStateTransition(self.status.value, SessionStatus.ACTIVE.value)
            
        self.status = SessionStatus.ACTIVE
        self.started_at = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)
        return True

    def end(self) -> bool:
        """Transition the session from CREATED or ACTIVE to ENDED.
        
        This method is idempotent:
        - If already ENDED, it returns False and performs no changes.
        - Otherwise, it transitions the status to ENDED and returns True.
        """
        if self.status == SessionStatus.ENDED:
            return False
            
        if self.status not in (SessionStatus.CREATED, SessionStatus.ACTIVE):
            raise InvalidStateTransition(self.status.value, SessionStatus.ENDED.value)

        self.status = SessionStatus.ENDED
        self.ended_at = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)
        return True

    @property
    def is_invite_valid(self) -> bool:
        """Invite is valid if the session is not ended."""
        return self.status in (SessionStatus.CREATED, SessionStatus.ACTIVE)


class ParticipantRole(str, Enum):
    AGENT = "AGENT"
    CUSTOMER = "CUSTOMER"


class ParticipantConnectionStatus(str, Enum):
    CONNECTED = "CONNECTED"
    DISCONNECTED = "DISCONNECTED"
    LEFT = "LEFT"


class DomainParticipant:
    def __init__(
        self,
        session_id: uuid.UUID,
        role: ParticipantRole,
        user_id: str,
        id: Optional[uuid.UUID] = None,
        joined_at: Optional[datetime] = None,
        left_at: Optional[datetime] = None,
        connection_status: Optional[ParticipantConnectionStatus] = None,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
    ):
        self.id = id or uuid.uuid4()
        self.session_id = session_id
        self.role = role
        self.user_id = user_id
        
        now = datetime.now(timezone.utc)
        self.joined_at = joined_at or now
        self.left_at = left_at
        self.connection_status = connection_status or ParticipantConnectionStatus.CONNECTED
        self.created_at = created_at or now
        self.updated_at = updated_at or now

    def disconnect(self) -> bool:
        """Transition participant status to DISCONNECTED.
        
        Idempotent: returns False if already DISCONNECTED.
        """
        if self.connection_status == ParticipantConnectionStatus.LEFT:
            raise InvalidConnectionTransition(self.connection_status.value, ParticipantConnectionStatus.DISCONNECTED.value)
            
        if self.connection_status == ParticipantConnectionStatus.DISCONNECTED:
            return False
            
        self.connection_status = ParticipantConnectionStatus.DISCONNECTED
        self.updated_at = datetime.now(timezone.utc)
        return True

    def reconnect(self) -> bool:
        """Transition participant status from DISCONNECTED to CONNECTED.
        
        Only allowed from DISCONNECTED.
        """
        if self.connection_status != ParticipantConnectionStatus.DISCONNECTED:
            raise InvalidConnectionTransition(self.connection_status.value, ParticipantConnectionStatus.CONNECTED.value)
            
        self.connection_status = ParticipantConnectionStatus.CONNECTED
        self.updated_at = datetime.now(timezone.utc)
        return True

    def leave(self) -> bool:
        """Transition participant status to LEFT.
        
        Idempotent: returns False if already LEFT.
        """
        if self.connection_status == ParticipantConnectionStatus.LEFT:
            return False
            
        self.connection_status = ParticipantConnectionStatus.LEFT
        self.left_at = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)
        return True



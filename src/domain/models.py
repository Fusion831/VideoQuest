from datetime import datetime, timezone
from enum import Enum
import secrets
from typing import Optional
import uuid

from src.core.exceptions import InvalidStateTransition


class SessionStatus(str, Enum):
    CREATED = "CREATED"
    ACTIVE = "ACTIVE"  # Extension point: Transition to ACTIVE will be handled by the Participant domain
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


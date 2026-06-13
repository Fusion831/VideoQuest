from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional
import uuid


class SessionEventType(str, Enum):
    SESSION_CREATED = "SESSION_CREATED"
    SESSION_STARTED = "SESSION_STARTED"
    SESSION_ENDED = "SESSION_ENDED"
    # Extension points for other domains
    PARTICIPANT_JOINED = "PARTICIPANT_JOINED"
    PARTICIPANT_LEFT = "PARTICIPANT_LEFT"
    CHAT_MESSAGE_SENT = "CHAT_MESSAGE_SENT"
    RECORDING_STARTED = "RECORDING_STARTED"
    RECORDING_STOPPED = "RECORDING_STOPPED"


class DomainSessionEvent:
    def __init__(
        self,
        session_id: uuid.UUID,
        event_type: SessionEventType,
        id: Optional[uuid.UUID] = None,
        timestamp: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.id = id or uuid.uuid4()
        self.session_id = session_id
        self.event_type = event_type
        self.timestamp = timestamp or datetime.now(timezone.utc)
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": str(self.id),
            "session_id": str(self.session_id),
            "event_type": self.event_type.value,
            "timestamp": self.timestamp.isoformat(),
            "metadata": self.metadata,
        }

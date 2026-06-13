from datetime import datetime, timezone
import uuid
from typing import Any, Dict

from sqlalchemy import Column, String, DateTime, ForeignKey, Index, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.types import TypeDecorator, CHAR

from src.infrastructure.database import Base
from src.domain.models import DomainSession, SessionStatus
from src.domain.events import DomainSessionEvent, SessionEventType


# UUID type wrapper to support both SQLite (TEXT) and PostgreSQL (UUID) seamlessly
class GUID(TypeDecorator):
    """Platform-independent GUID type.
    Uses PostgreSQL's UUID type, otherwise uses CHAR(36), storing as stringified hex values.
    """
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == "postgresql":
            return value
        else:
            if isinstance(value, uuid.UUID):
                return str(value)
            else:
                return str(uuid.UUID(value))

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        else:
            if not isinstance(value, uuid.UUID):
                return uuid.UUID(value)
            return value


# JSON type wrapper to support JSON in SQLite and JSONB in PostgreSQL
class SafeJSON(TypeDecorator):
    impl = JSONB
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB)
        else:
            from sqlalchemy import JSON
            return dialect.type_descriptor(JSON)


class SessionORM(Base):
    __tablename__ = "sessions"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    invite_token = Column(String(255), unique=True, nullable=False, index=True)
    status = Column(String(50), nullable=False, default=SessionStatus.CREATED.value)
    agent_id = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    def to_domain(self) -> DomainSession:
        return DomainSession(
            id=self.id,
            invite_token=self.invite_token,
            status=SessionStatus(self.status),
            agent_id=self.agent_id,
            created_at=self.created_at.replace(tzinfo=timezone.utc) if self.created_at else None,
            started_at=self.started_at.replace(tzinfo=timezone.utc) if self.started_at else None,
            ended_at=self.ended_at.replace(tzinfo=timezone.utc) if self.ended_at else None,
            updated_at=self.updated_at.replace(tzinfo=timezone.utc) if self.updated_at else None,
        )

    @classmethod
    def from_domain(cls, domain: DomainSession) -> "SessionORM":
        return cls(
            id=domain.id,
            invite_token=domain.invite_token,
            status=domain.status.value,
            agent_id=domain.agent_id,
            created_at=domain.created_at,
            started_at=domain.started_at,
            ended_at=domain.ended_at,
            updated_at=domain.updated_at,
        )


class SessionEventORM(Base):
    __tablename__ = "session_events"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    session_id = Column(GUID, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String(100), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    metadata_json = Column("metadata", SafeJSON, nullable=False, default=dict)

    def to_domain(self) -> DomainSessionEvent:
        return DomainSessionEvent(
            id=self.id,
            session_id=self.session_id,
            event_type=SessionEventType(self.event_type),
            timestamp=self.timestamp.replace(tzinfo=timezone.utc) if self.timestamp else None,
            metadata=self.metadata_json,
        )

    @classmethod
    def from_domain(cls, domain: DomainSessionEvent) -> "SessionEventORM":
        return cls(
            id=domain.id,
            session_id=domain.session_id,
            event_type=domain.event_type.value,
            timestamp=domain.timestamp,
            metadata_json=domain.metadata,
        )


# Setup indexes on SessionEventORM for fast retrieval of events by session
Index("idx_session_events_session_id_timestamp", SessionEventORM.session_id, SessionEventORM.timestamp)

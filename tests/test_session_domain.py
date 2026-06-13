from datetime import datetime
import pytest
import uuid

from src.domain.models import DomainSession, SessionStatus


def test_session_initial_state():
    """Verify that a session is correctly initialized with default values."""
    agent_id = "agent_123"
    session = DomainSession(agent_id=agent_id)

    assert isinstance(session.id, uuid.UUID)
    assert len(session.invite_token) > 20
    assert session.status == SessionStatus.CREATED
    assert session.agent_id == agent_id
    assert isinstance(session.created_at, datetime)
    assert session.started_at is None
    assert session.ended_at is None
    assert isinstance(session.updated_at, datetime)
    assert session.is_invite_valid is True


def test_transition_created_to_ended():
    """Verify CREATED -> ENDED transition is successful and returns True."""
    session = DomainSession(agent_id="agent_1")
    
    transitioned = session.end()
    
    assert transitioned is True
    assert session.status == SessionStatus.ENDED
    assert session.started_at is None
    assert isinstance(session.ended_at, datetime)
    assert session.is_invite_valid is False


def test_idempotent_session_termination():
    """Verify that ending an already ended session is idempotent (returns False)."""
    session = DomainSession(agent_id="agent_1")
    
    # First termination
    transitioned_first = session.end()
    assert transitioned_first is True
    
    # Second termination (idempotency test)
    transitioned_second = session.end()
    assert transitioned_second is False
    assert session.status == SessionStatus.ENDED

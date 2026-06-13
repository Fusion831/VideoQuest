from datetime import datetime
import pytest
import uuid

from src.core.exceptions import InvalidConnectionTransition
from src.domain.models import (
    DomainParticipant,
    ParticipantRole,
    ParticipantConnectionStatus,
)


def test_participant_initial_state():
    """Verify that a participant is correctly initialized with default values."""
    session_id = uuid.uuid4()
    user_id = "user_123"
    participant = DomainParticipant(
        session_id=session_id,
        role=ParticipantRole.AGENT,
        user_id=user_id,
    )

    assert isinstance(participant.id, uuid.UUID)
    assert participant.session_id == session_id
    assert participant.role == ParticipantRole.AGENT
    assert participant.user_id == user_id
    assert participant.connection_status == ParticipantConnectionStatus.CONNECTED
    assert isinstance(participant.joined_at, datetime)
    assert participant.left_at is None
    assert isinstance(participant.created_at, datetime)
    assert isinstance(participant.updated_at, datetime)


def test_participant_disconnect_reconnect():
    """Verify CONNECTED -> DISCONNECTED -> CONNECTED transitions."""
    participant = DomainParticipant(
        session_id=uuid.uuid4(),
        role=ParticipantRole.CUSTOMER,
        user_id="cust_1",
    )

    # Disconnect
    assert participant.disconnect() is True
    assert participant.connection_status == ParticipantConnectionStatus.DISCONNECTED

    # Reconnect
    assert participant.reconnect() is True
    assert participant.connection_status == ParticipantConnectionStatus.CONNECTED


def test_participant_idempotent_transitions():
    """Verify state transitions are idempotent where expected."""
    participant = DomainParticipant(
        session_id=uuid.uuid4(),
        role=ParticipantRole.AGENT,
        user_id="agent_1",
    )

    # Disconnect once
    assert participant.disconnect() is True
    # Disconnect again
    assert participant.disconnect() is False
    assert participant.connection_status == ParticipantConnectionStatus.DISCONNECTED

    # Leave once
    assert participant.leave() is True
    # Leave again
    assert participant.leave() is False
    assert participant.connection_status == ParticipantConnectionStatus.LEFT


def test_invalid_transitions_from_left():
    """Verify transitions from LEFT to CONNECTED/DISCONNECTED are invalid."""
    participant = DomainParticipant(
        session_id=uuid.uuid4(),
        role=ParticipantRole.CUSTOMER,
        user_id="cust_1",
    )

    # Go to LEFT state
    participant.leave()
    assert participant.connection_status == ParticipantConnectionStatus.LEFT

    # Try disconnect
    with pytest.raises(InvalidConnectionTransition):
        participant.disconnect()

    # Try reconnect
    with pytest.raises(InvalidConnectionTransition):
        participant.reconnect()


def test_invalid_transitions_from_connected():
    """Verify reconnecting from CONNECTED state is invalid."""
    participant = DomainParticipant(
        session_id=uuid.uuid4(),
        role=ParticipantRole.CUSTOMER,
        user_id="cust_1",
    )

    assert participant.connection_status == ParticipantConnectionStatus.CONNECTED

    with pytest.raises(InvalidConnectionTransition):
        participant.reconnect()

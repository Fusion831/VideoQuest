class DomainException(Exception):
    """Base exception for all domain-related errors."""
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class SessionNotFound(DomainException):
    """Raised when a session cannot be found."""
    def __init__(self, session_id: str):
        super().__init__(f"Session with ID {session_id} not found.")
        self.session_id = session_id


class InvalidInvite(DomainException):
    """Raised when an invite token is invalid, expired, or belongs to an inactive/ended session."""
    def __init__(self, token: str, reason: str = "Invalid token"):
        super().__init__(f"Invite token validation failed: {reason}.")
        self.token = token
        self.reason = reason


class SessionAlreadyEnded(DomainException):
    """Raised when attempting an operation on a session that has already ended."""
    def __init__(self, session_id: str):
        super().__init__(f"Session with ID {session_id} has already ended.")
        self.session_id = session_id


class InvalidStateTransition(DomainException):
    """Raised when a session transition is invalid."""
    def __init__(self, current_status: str, target_status: str):
        super().__init__(f"Invalid transition from {current_status} to {target_status}.")
        self.current_status = current_status
        self.target_status = target_status


class ParticipantNotFound(DomainException):
    """Raised when a participant cannot be found."""
    def __init__(self, participant_id: str):
        super().__init__(f"Participant with ID {participant_id} not found.")
        self.participant_id = participant_id


class ParticipantAlreadyJoined(DomainException):
    """Raised when attempting to join a session when already joined/connected."""
    def __init__(self, session_id: str, role: str):
        super().__init__(f"Participant with role {role} has already joined session {session_id}.")
        self.session_id = session_id
        self.role = role


class ParticipantAlreadyLeft(DomainException):
    """Raised when a participant who has already left attempts actions."""
    def __init__(self, participant_id: str):
        super().__init__(f"Participant with ID {participant_id} has already left the session.")
        self.participant_id = participant_id


class InvalidConnectionTransition(DomainException):
    """Raised when an invalid participant connection state transition is attempted."""
    def __init__(self, current_status: str, target_status: str):
        super().__init__(f"Invalid connection status transition from {current_status} to {target_status}.")
        self.current_status = current_status
        self.target_status = target_status


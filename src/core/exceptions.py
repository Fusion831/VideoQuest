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

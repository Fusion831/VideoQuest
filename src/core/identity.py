from dataclasses import dataclass
from enum import Enum
from typing import Set

class ParticipantRole(str, Enum):
    AGENT = "AGENT"
    CUSTOMER = "CUSTOMER"

class Permission(str, Enum):
    CREATE_SESSION = "CREATE_SESSION"
    END_SESSION = "END_SESSION"
    SEND_MESSAGE = "SEND_MESSAGE"
    JOIN_CALL = "JOIN_CALL"
    VIEW_DIAGNOSTICS = "VIEW_DIAGNOSTICS"

ROLE_PERMISSIONS = {
    ParticipantRole.AGENT: {
        Permission.CREATE_SESSION,
        Permission.END_SESSION,
        Permission.SEND_MESSAGE,
        Permission.JOIN_CALL,
        Permission.VIEW_DIAGNOSTICS,
    },
    ParticipantRole.CUSTOMER: {
        Permission.SEND_MESSAGE,
        Permission.JOIN_CALL,
    },
}

@dataclass(frozen=True)
class Identity:
    """Lightweight identity abstraction representing the caller."""
    user_id: str
    role: str  # e.g., "AGENT", "CUSTOMER"

    def has_permission(self, permission: Permission) -> bool:
        try:
            p_role = ParticipantRole(self.role.upper())
            return permission in ROLE_PERMISSIONS.get(p_role, set())
        except ValueError:
            return False

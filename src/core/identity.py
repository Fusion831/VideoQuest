from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Identity:
    """Lightweight identity abstraction representing the caller."""
    user_id: str
    role: str  # e.g., "agent", "customer"

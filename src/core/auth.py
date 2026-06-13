import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from src.core.config import settings

def generate_jwt(user_id: str, role: str, expires_in_hours: int = 24) -> str:
    """Generate a JWT token for a given user_id and role."""
    payload = {
        "sub": user_id,
        "role": role.upper(),
        "exp": datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

def decode_jwt(token: str) -> Optional[Dict[str, Any]]:
    """Decode and validate a JWT token, returning its payload if valid."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None

from datetime import datetime
from typing import Any, Dict, List, Optional
import uuid

from pydantic import BaseModel, Field, ConfigDict


class SessionCreateRequest(BaseModel):
    agent_id: str = Field(..., description="ID of the agent initiating the session")


class SessionResponse(BaseModel):
    id: uuid.UUID
    invite_token: str
    status: str
    agent_id: str
    created_at: datetime
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ValidateInviteRequest(BaseModel):
    invite_token: str = Field(..., description="The invite token to validate")


class ValidateInviteResponse(BaseModel):
    valid: bool
    session_id: uuid.UUID
    status: str


class SessionListResponse(BaseModel):
    sessions: List[SessionResponse]
    total: int


class SessionEventResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    event_type: str
    timestamp: datetime
    metadata: Dict[str, Any]

    model_config = ConfigDict(from_attributes=True)

import logging
import json
from typing import Dict, Optional, List
import redis.asyncio as aioredis
from src.core.config import settings

logger = logging.getLogger(__name__)

# Redis Client Instance / Pool
_redis_client: Optional[aioredis.Redis] = None


def get_redis_client() -> aioredis.Redis:
    """Get or initialize the global async Redis client."""
    global _redis_client
    if _redis_client is not None:
        try:
            import asyncio
            loop = asyncio.get_running_loop()
            if getattr(_redis_client, "_vq_loop", None) != loop:
                logger.info("Event loop changed, re-initializing Redis connection pool.")
                _redis_client = None
        except RuntimeError:
            pass

    if _redis_client is None:
        logger.info(f"Initializing async Redis connection pool targeting: {settings.REDIS_URL}")
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_timeout=None,
            socket_connect_timeout=None,
        )
        try:
            import asyncio
            _redis_client._vq_loop = asyncio.get_running_loop()
        except RuntimeError:
            _redis_client._vq_loop = None
            
    return _redis_client


async def close_redis():
    """Close the global Redis client pool."""
    global _redis_client
    if _redis_client is not None:
        logger.info("Closing Redis connection pool.")
        await _redis_client.close()
        _redis_client = None


class RedisPresenceService:
    def __init__(self, client: Optional[aioredis.Redis] = None):
        self._client = client

    @property
    def client(self) -> aioredis.Redis:
        return self._client or get_redis_client()

    def _presence_key(self, session_id: str) -> str:
        return f"session:{session_id}:presence"

    def _connections_key(self, session_id: str) -> str:
        return f"session:{session_id}:active_connections"

    def _abandoned_expiry_key(self, session_id: str) -> str:
        return f"session:{session_id}:abandoned_expiry"

    async def update_presence(self, session_id: str, participant_id: str, status: str):
        """Set participant presence state in Redis."""
        key = self._presence_key(session_id)
        await self.client.hset(key, participant_id, status)

    async def get_presence(self, session_id: str) -> Dict[str, str]:
        """Get presence mapping of participant_id -> connection_status for a session."""
        key = self._presence_key(session_id)
        return await self.client.hgetall(key)

    async def register_connection(self, session_id: str, connection_id: str) -> int:
        """Register a unique active connection for the session, returns current connection count."""
        key = self._connections_key(session_id)
        await self.client.sadd(key, connection_id)
        return await self.client.scard(key)

    async def unregister_connection(self, session_id: str, connection_id: str) -> int:
        """Unregister a unique connection, returns remaining connection count."""
        key = self._connections_key(session_id)
        await self.client.srem(key, connection_id)
        return await self.client.scard(key)

    async def get_connection_count(self, session_id: str) -> int:
        """Get count of active websocket connections for a session."""
        key = self._connections_key(session_id)
        return await self.client.scard(key)

    async def set_abandonment_expiry(self, session_id: str, ttl_seconds: int = 60):
        """Mark session as abandoned with a set expiration window."""
        key = self._abandoned_expiry_key(session_id)
        # Store abandonment metadata as a simple JSON string or stringified timestamp
        from datetime import datetime, timezone, timedelta
        expiry_time = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
        data = {
            "session_id": session_id,
            "abandoned_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": expiry_time.isoformat(),
        }
        await self.client.set(key, json.dumps(data), ex=ttl_seconds)

    async def get_abandoned_sessions(self) -> List[str]:
        """Scan keys to find active abandonment sessions."""
        # Finds all keys matching session:*:abandoned_expiry
        cursor = 0
        keys = []
        while True:
            cursor, batch = await self.client.scan(cursor, match="session:*:abandoned_expiry", count=100)
            keys.extend(batch)
            if cursor == 0:
                break
        
        # Extract session IDs from keys
        session_ids = []
        for key in keys:
            parts = key.split(":")
            if len(parts) >= 2:
                session_ids.append(parts[1])
        return session_ids

    async def clear_abandonment_expiry(self, session_id: str):
        """Remove abandonment tracking for a session."""
        key = self._abandoned_expiry_key(session_id)
        await self.client.delete(key)

    async def clear_session_data(self, session_id: str):
        """Delete all presence keys for a ended session."""
        await self.client.delete(self._presence_key(session_id))
        await self.client.delete(self._connections_key(session_id))
        await self.client.delete(self._abandoned_expiry_key(session_id))

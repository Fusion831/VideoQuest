import asyncio
import json
import logging
from typing import Dict, List, Set
from fastapi import WebSocket
from src.infrastructure.redis import get_redis_client

logger = logging.getLogger(__name__)


class WebSocketManager:
    def __init__(self):
        # Maps session_id (str) -> List of local WebSockets
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Maps session_id (str) -> asyncio Task for Redis PubSub listener
        self.pubsub_tasks: Dict[str, asyncio.Task] = {}
        # Maps session_id (str) -> asyncio Event indicating PubSub subscription is active
        self.pubsub_ready: Dict[str, asyncio.Event] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        """Accept connection, register locally, and subscribe to Redis channel if needed."""
        await websocket.accept()
        
        session_str = str(session_id)
        if session_str not in self.active_connections:
            self.active_connections[session_str] = []
            
        self.active_connections[session_str].append(websocket)
        logger.info(f"WebSocket client connected to session {session_str}. Total local connections: {len(self.active_connections[session_str])}")

        # Start Redis PubSub subscriber task for this session if not already listening
        if session_str not in self.pubsub_tasks:
            ready_event = asyncio.Event()
            self.pubsub_ready[session_str] = ready_event
            task = asyncio.create_task(self._redis_subscribe_loop(session_str, ready_event))
            self.pubsub_tasks[session_str] = task
            # Wait up to 2 seconds for the subscription to complete to prevent race conditions
            try:
                await asyncio.wait_for(ready_event.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                logger.warning(f"Timeout waiting for Redis subscription readiness for session {session_str}")
        elif session_str in self.pubsub_ready:
            try:
                await asyncio.wait_for(self.pubsub_ready[session_str].wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass

    async def disconnect(self, session_id: str, websocket: WebSocket):
        """Unregister connection and clean up subscription loop if no clients remain."""
        session_str = str(session_id)
        if session_str in self.active_connections:
            if websocket in self.active_connections[session_str]:
                self.active_connections[session_str].remove(websocket)
                
            if not self.active_connections[session_str]:
                # No more clients on this session, cancel PubSub listener
                del self.active_connections[session_str]
                if session_str in self.pubsub_tasks:
                    self.pubsub_tasks[session_str].cancel()
                    del self.pubsub_tasks[session_str]
                if session_str in self.pubsub_ready:
                    del self.pubsub_ready[session_str]
                logger.info(f"Cleaned up Redis PubSub listener for session {session_str}")
                    
        logger.info(f"WebSocket client disconnected from session {session_str}.")

    async def broadcast_to_session(self, session_id: str, event_type: str, payload: dict):
        """Publish event to Redis PubSub. Any listening server instance will receive and forward it."""
        session_str = str(session_id)
        message = {
            "event_type": event_type,
            "payload": payload
        }
        redis_client = get_redis_client()
        channel = f"session:{session_str}:pubsub"
        await redis_client.publish(channel, json.dumps(message))

    async def _redis_subscribe_loop(self, session_id: str, ready_event: asyncio.Event):
        """Subscriber loop listening to Redis channel and forwarding events to local connections."""
        channel = f"session:{session_id}:pubsub"
        logger.info(f"Starting Redis listener loop for session {session_id}")
        
        retry_delay = 1.0
        while True:
            try:
                redis_client = get_redis_client()
                async with redis_client.pubsub() as pubsub:
                    await pubsub.subscribe(channel)
                    logger.info(f"Subscribed to Redis channel {channel}")
                    retry_delay = 1.0  # Reset retry delay on successful subscription
                    
                    # Signal that subscription is active
                    ready_event.set()
                    
                    async for message in pubsub.listen():
                        if message["type"] == "message":
                            data = message["data"]
                            # Forward message to all local websocket clients for this session
                            connections = self.active_connections.get(session_id, [])
                            if connections:
                                # Send to all connected sockets
                                dead_connections = []
                                for ws in connections:
                                    try:
                                        await ws.send_text(data)
                                    except Exception as e:
                                        logger.warning(f"Failed to send to websocket in session {session_id}: {e}")
                                        dead_connections.append(ws)
                                
                                # Clean up any dead connections we encountered
                                for dead in dead_connections:
                                    if dead in connections:
                                        connections.remove(dead)

            except asyncio.CancelledError:
                logger.info(f"Redis listener loop for session {session_id} was cancelled.")
                break
            except Exception as e:
                logger.error(f"Error in Redis listener loop for session {session_id}, retrying in {retry_delay}s: {e}", exc_info=True)
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 60.0)  # Exponential backoff


# Global WebSocket Manager instance
ws_manager = WebSocketManager()

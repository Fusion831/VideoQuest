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
            task = asyncio.create_task(self._redis_subscribe_loop(session_str))
            self.pubsub_tasks[session_str] = task

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

    async def _redis_subscribe_loop(self, session_id: str):
        """Subscriber loop listening to Redis channel and forwarding events to local connections."""
        redis_client = get_redis_client()
        pubsub = redis_client.pubsub()
        channel = f"session:{session_id}:pubsub"
        
        try:
            await pubsub.subscribe(channel)
            logger.info(f"Started listening on Redis channel {channel}")
            
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
        except Exception as e:
            logger.error(f"Error in Redis listener loop for session {session_id}: {e}", exc_info=True)
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()


# Global WebSocket Manager instance
ws_manager = WebSocketManager()

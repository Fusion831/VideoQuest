import asyncio
import logging
from src.infrastructure.database import AsyncSessionLocal
from src.infrastructure.repositories import SessionRepository, SessionEventRepository, ParticipantRepository
from src.infrastructure.redis import RedisPresenceService
from src.services.session_service import SessionService
from src.domain.models import SessionStatus
from src.core.identity import Identity
from src.infrastructure.websocket_manager import ws_manager

logger = logging.getLogger(__name__)


async def monitor_abandoned_sessions():
    """Background loop to clean up abandoned sessions whose grace periods have expired."""
    logger.info("Starting Session Abandonment Monitor task.")
    redis_presence = RedisPresenceService()
    
    while True:
        try:
            await asyncio.sleep(5)
            
            # Open database session
            async with AsyncSessionLocal() as db_session:
                session_repo = SessionRepository(db_session)
                event_repo = SessionEventRepository(db_session)
                participant_repo = ParticipantRepository(db_session)
                
                session_service = SessionService(
                    session_repo=session_repo,
                    event_repo=event_repo,
                    db_session=db_session,
                    participant_repo=participant_repo,
                )
                
                # Fetch all ABANDONED sessions from DB
                abandoned_sessions, _ = await session_repo.list_sessions(limit=100, status=SessionStatus.ABANDONED)
                
                for session in abandoned_sessions:
                    # Check if the Redis abandonment expiry key exists
                    exists = await redis_presence.client.exists(redis_presence._abandoned_expiry_key(str(session.id)))
                    
                    if not exists:
                        # Reconnect grace window has expired! Clean up and end the session
                        logger.info(f"Reconnection grace window expired for abandoned session {session.id}. Automatically terminating.")
                        
                        # Use session_service to cleanly end the session
                        system_identity = Identity(user_id="system_lifecycle_monitor", role="agent")
                        await session_service.end_session(session.id, system_identity)
                        
                        # Clear presence data from Redis
                        await redis_presence.clear_session_data(str(session.id))
                        
                        # Broadcast session ended event
                        await ws_manager.broadcast_to_session(
                            str(session.id),
                            "SESSION_ENDED",
                            {
                                "session_id": str(session.id),
                                "ended_by": "system_lifecycle_monitor",
                                "reason": "Abandonment grace period expired",
                            }
                        )
                        
        except asyncio.CancelledError:
            logger.info("Session Abandonment Monitor task stopped.")
            break
        except Exception as e:
            logger.error(f"Error in Session Abandonment Monitor loop: {e}", exc_info=True)

import os
from livekit.api import AccessToken, VideoGrants, LiveKitAPI
from livekit.protocol import room
from src.core.config import settings
from src.core.logging import logger


class LiveKitService:
    def __init__(
        self,
        url: str = settings.LIVEKIT_URL,
        api_key: str = settings.LIVEKIT_API_KEY,
        api_secret: str = settings.LIVEKIT_API_SECRET,
    ):
        self.url = url
        self.api_key = api_key
        self.api_secret = api_secret

    def generate_token(self, room_name: str, identity: str, name: str) -> str | None:
        """Generate a LiveKit JWT token for symmetric audio/video room participation.

        Returns None if key/secret are missing or token generation fails (Degraded Mode support).
        """
        if not self.api_key or not self.api_secret:
            logger.warning("LiveKit API key or secret not configured. Skipping token generation.")
            return None

        try:
            token = (
                AccessToken(self.api_key, self.api_secret)
                .with_identity(identity)
                .with_name(name)
                .with_grants(
                    VideoGrants(
                        room_join=True,
                        room=room_name,
                        can_publish=True,
                        can_subscribe=True,
                    )
                )
            )
            return token.to_jwt()
        except Exception as e:
            logger.exception(f"Failed to generate LiveKit token for room {room_name}: {e}")
            return None

    async def delete_room(self, room_name: str) -> None:
        """Send a request to LiveKit to delete the room and disconnect all participants.

        This call is wrapped in a try/except block so failure does not block session termination.
        """
        if not self.api_key or not self.api_secret:
            logger.warning("LiveKit API key or secret not configured. Skipping room deletion.")
            return

        api = None
        try:
            api = LiveKitAPI(self.url, self.api_key, self.api_secret)
            req = room.DeleteRoomRequest(room=room_name)
            await api.room.delete_room(req)
            logger.info(f"Successfully sent request to delete LiveKit room: {room_name}")
        except Exception as e:
            logger.warning(f"Failed to delete LiveKit room {room_name} (ignoring to protect lifecycle): {e}")
        finally:
            if api:
                try:
                    await api.aclose()
                except Exception:
                    pass

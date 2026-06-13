import os

class Settings:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/videoquest")
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    LIVEKIT_URL: str = os.getenv("LIVEKIT_URL", "http://localhost:7880")
    LIVEKIT_PUBLIC_URL: str = os.getenv("LIVEKIT_PUBLIC_URL", "ws://localhost:7880")
    LIVEKIT_API_KEY: str = os.getenv("LIVEKIT_API_KEY", "devkey")
    LIVEKIT_API_SECRET: str = os.getenv("LIVEKIT_API_SECRET", "secret01234567890123456789abcdef")
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "videoquest_super_secret_key_1234567890")
    JWT_ALGORITHM: str = "HS256"

settings = Settings()

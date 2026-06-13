from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.core.logging import setup_logging, logger
from src.infrastructure.database import Base, engine
from src.api.routes import router as session_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup actions
    setup_logging()
    logger.info("Initializing database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables initialized.")
    yield
    # Shutdown actions
    logger.info("Closing database engine connections...")
    await engine.dispose()
    logger.info("Database engine connections closed.")


app = FastAPI(
    title="VideoQuest Real-Time Video Support Platform",
    description="Session Management Domain API",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(session_router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    return {"status": "healthy"}

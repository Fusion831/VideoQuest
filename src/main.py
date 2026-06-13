from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.core.logging import setup_logging, logger
from src.infrastructure.database import Base, engine
from src.api.routes import router as session_router, auth_router


import asyncio
from src.services.lifecycle_monitor import monitor_abandoned_sessions
from src.infrastructure.redis import close_redis


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup actions
    setup_logging()
    logger.info("Initializing database tables...")
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    # Ensure new columns exist in sessions table for existing databases
    for col_name, col_type in [
        ("customer_name", "VARCHAR(255)"),
        ("issue_description", "TEXT"),
        ("video_escalation_status", "VARCHAR(50) DEFAULT 'NOT_STARTED'")
    ]:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(f"ALTER TABLE sessions ADD COLUMN {col_name} {col_type}"))
                logger.info(f"Dynamically added column {col_name} to sessions table.")
        except Exception:
            # Column probably already exists or we are running in SQLite where ADD COLUMN has different constraints
            pass

    # Also make agent_id nullable in sessions table
    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE sessions ALTER COLUMN agent_id DROP NOT NULL"))
            logger.info("Made agent_id column in sessions table nullable.")
    except Exception:
        pass
    logger.info("Database tables initialized.")
    
    # Start background lifecycle monitor
    monitor_task = asyncio.create_task(monitor_abandoned_sessions())
    
    yield
    # Shutdown actions
    logger.info("Stopping background tasks...")
    monitor_task.cancel()
    try:
        await monitor_task
    except asyncio.CancelledError:
        pass
        
    logger.info("Closing database engine connections...")
    await engine.dispose()
    logger.info("Database engine connections closed.")
    
    # Close Redis client
    await close_redis()


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
app.include_router(auth_router, prefix="/api/v1")



@app.get("/health")
async def health_check():
    return {"status": "healthy"}

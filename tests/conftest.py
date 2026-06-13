import asyncio
from typing import AsyncGenerator
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from src.infrastructure.database import Base
from src.main import app
from src.api.dependencies import get_db_session

DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for each test case."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def db_engine():
    """Session-wide database engine setup."""
    engine = create_async_engine(DATABASE_URL, echo=False)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    """Test-scoped database session. Re-creates tables per test for database isolation."""
    async with db_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(
        bind=db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with session_maker() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_session) -> AsyncGenerator[AsyncClient, None]:
    """FastAPI AsyncClient configured with test database session override."""
    async def override_get_db_session():
        yield db_session

    from fastapi import Header
    from typing import Optional
    from src.api.dependencies import get_current_identity
    from src.core.identity import AuthenticatedIdentity
    from src.core.auth import decode_jwt

    async def override_get_current_identity(
        authorization: Optional[str] = Header(None),
        x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
        x_user_role: Optional[str] = Header(None, alias="X-User-Role"),
    ) -> AuthenticatedIdentity:
        if authorization and authorization.startswith("Bearer "):
            token = authorization.split(" ")[1]
            payload = decode_jwt(token)
            if payload:
                return AuthenticatedIdentity(user_id=payload.get("sub"), role=payload.get("role").upper())
        user_id = x_user_id or "agent_1"
        role = x_user_role or "agent"
        return AuthenticatedIdentity(user_id=user_id, role=role.upper())

    app.dependency_overrides[get_db_session] = override_get_db_session
    app.dependency_overrides[get_current_identity] = override_get_current_identity
    
    # Using the standard ASGITransport for HTTPX in-memory API calls
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac
        
    app.dependency_overrides.clear()


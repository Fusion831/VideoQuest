# VideoQuest — Project Handoff

**Repo:** `Fusion831/VideoQuest`  
**Last stable commit:** `7fd1ab6` — *Fixed a websocket dependency issue, and some UX issues*  
**System status:** All 45 tests passing. All 4 Docker containers healthy. WebSocket functional.

---

## What Is This

VideoQuest is a **real-time video support platform** backend + frontend. An agent creates a support session, shares an invite link, a customer joins, and they communicate via video (LiveKit — not yet integrated) and text chat, with full presence tracking, lifecycle automation, and audit logging.

The system is a **hackathon-grade production prototype** — meaning architecture quality is prioritised, but some production concerns (auth tokens, rate limiting, multi-worker scaling) are intentionally deferred.

---

## Technology Stack

| Layer | Technology |
|---|---|
| **Backend runtime** | Python 3.13, FastAPI, Uvicorn |
| **Package manager** | `uv` (lock file: `uv.lock`) |
| **Database** | PostgreSQL 15 (asyncpg + SQLAlchemy 2.0 async) |
| **Migrations** | Alembic |
| **Cache / Pub-Sub** | Redis 7 (redis-py async) |
| **WebSocket transport** | `websockets` 16.0 (required by uvicorn) |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| **Containerisation** | Docker Compose (single-file, 4 services) |
| **Testing** | pytest + pytest-asyncio, SQLite in-memory for isolation |

---

## Project Structure

```
VideoQuest/
├── src/                        # Backend application
│   ├── main.py                 # FastAPI app, lifespan, CORS, router mount
│   ├── core/
│   │   ├── config.py           # Settings (reads env vars)
│   │   ├── exceptions.py       # All domain exceptions
│   │   ├── identity.py         # Lightweight Identity(user_id, role) value object
│   │   └── logging.py          # Structured logging setup
│   ├── domain/
│   │   ├── models.py           # DomainSession, DomainParticipant, DomainChatMessage
│   │   └── events.py           # DomainSessionEvent, SessionEventType enum
│   ├── infrastructure/
│   │   ├── database.py         # AsyncSessionLocal, engine, Base
│   │   ├── models.py           # ORM models (SessionORM, ParticipantORM, ChatMessageORM, SessionEventORM)
│   │   ├── repositories.py     # Repository classes (one per aggregate)
│   │   ├── redis.py            # RedisPresenceService, get_redis_client
│   │   └── websocket_manager.py# WebSocketManager (local conns + Redis PubSub fan-out)
│   ├── services/
│   │   ├── session_service.py  # SessionService (create, get, end, list, events)
│   │   ├── participant_service.py # ParticipantService (join, leave, disconnect, reconnect)
│   │   ├── chat_service.py     # ChatService + flush_system_message helpers
│   │   └── lifecycle_monitor.py# Background task: auto-end abandoned sessions
│   └── api/
│       ├── dependencies.py     # FastAPI DI: get_session_service, get_participant_service, get_chat_service, get_current_identity
│       ├── routes.py           # All REST endpoints + WebSocket gateway
│       └── schemas.py          # Pydantic request/response models
├── migrations/                 # Alembic migration files
├── tests/                      # 45 integration tests
│   ├── conftest.py             # SQLite in-memory DB fixture, async test client
│   ├── test_session_domain.py
│   ├── test_session_service.py
│   ├── test_participant_domain.py
│   ├── test_participant_service.py
│   ├── test_participant_api.py
│   ├── test_api.py
│   ├── test_chat.py
│   └── test_realtime.py        # Redis presence tests
├── web/                        # Next.js frontend
│   └── src/
│       ├── app/
│       │   ├── page.tsx        # Landing page (redirects to /agent)
│       │   ├── agent/page.tsx  # Agent dashboard (session list + create)
│       │   ├── join/[inviteToken]/page.tsx  # Customer invite landing
│       │   └── session/[sessionId]/page.tsx # Session room (main dev UI)
│       ├── components/
│       │   └── ChatPanel.tsx   # Chat message feed + composer
│       └── lib/
│           ├── types.ts        # TypeScript interfaces for all API models
│           └── api-client.ts   # Typed fetch wrapper for all backend endpoints
├── Dockerfile.backend          # Python multi-stage build
├── web/Dockerfile              # Node multi-stage build (standalone output)
├── docker-compose.yml          # 4 services: db, redis, backend, frontend
├── pyproject.toml              # Python dependencies
└── alembic.ini                 # Alembic config (points to DATABASE_URL env var)
```

---

## Running the System

### Docker (recommended — full stack)

```bash
# First start / clean start
docker compose up --build -d

# Subsequent starts (no rebuild)
docker compose up -d

# View logs
docker logs videoquest-backend -f
docker logs videoquest-frontend -f

# Full reset (wipes all PostgreSQL and Redis data)
docker compose down -v
docker compose up --build -d
```

**Services:**
| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### Local Development (backend only)

```bash
# Install dependencies
uv sync

# Run backend (requires local PG + Redis)
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# Run tests (uses SQLite in-memory, no external dependencies needed)
uv run pytest -v

# Run migrations
uv run alembic upgrade head
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/videoquest` | PostgreSQL async connection string |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection string |
| `LOG_LEVEL` | `INFO` | Logging level |
| `ENVIRONMENT` | `development` | Runtime environment tag |
| `NEXT_PUBLIC_API_URL` | (none — falls back to `window.location.origin`) | Frontend → backend base URL |

---

## Identity & Authentication

There is **no JWT or session token authentication** — this is deferred. Identity is conveyed via plain HTTP headers:

```
X-User-ID: agent1
X-User-Role: agent
```

The `get_current_identity` FastAPI dependency reads these headers and constructs an `Identity(user_id, role)` value object. If headers are absent it defaults to `default_user / agent`.

**Important for LiveKit integration:** Before going to production, WebSocket connections and API endpoints must require a signed token. The hook point is `get_current_identity` in `dependencies.py`.

---

## Domain Architecture

### Session Domain

**Model:** `DomainSession`

**Status machine:**
```
CREATED → ACTIVE → ABANDONED → ENDED
    └──────────────────────────┘
         (any state can → ENDED)
```

- `CREATED`: Agent has created the session, no one has joined yet.
- `ACTIVE`: At least one participant has joined. Automatically set on first join.
- `ABANDONED`: All participants have disconnected. A 60-second Redis TTL grace period begins.
- `ENDED`: Terminal state. Immutable. All further writes are rejected.

**Key service:** `SessionService`
- `create_session(creator)` — agent-only
- `get_session(session_id)`
- `validate_invite(invite_token)`
- `end_session(session_id, initiator)` — **idempotent**
- `list_sessions(limit, offset, status)`
- `get_session_events(session_id)`

**Invite tokens:** Generated with `secrets.token_urlsafe(32)` — cryptographically secure, URL-safe. Valid as long as session is not ENDED.

---

### Participant Domain

**Model:** `DomainParticipant`

**Roles:** `AGENT` | `CUSTOMER`

**Connection status machine:**
```
CONNECTED ⇄ DISCONNECTED
     └──────────────→ LEFT (terminal)
```

**Rules enforced at service layer:**
- Only the session's assigned agent (`session.agent_id`) can join as AGENT.
- Customers must provide the correct `invite_token`.
- One participant per role per session (unique constraint in DB).
- Duplicate join (same user, CONNECTED) → idempotent return.
- Duplicate join (same user, DISCONNECTED) → treated as reconnect.
- Duplicate join (LEFT) → `ParticipantAlreadyLeft` error.
- Different user, same role → `ParticipantAlreadyJoined` error.

**Key service:** `ParticipantService`
- `join_session(session_id, identity, invite_token)` — handles all join/reconnect cases
- `leave_session(session_id, participant_id)` — marks LEFT, ends session, marks others LEFT
- `disconnect_participant(session_id, participant_id)` — marks DISCONNECTED, triggers ABANDONED if all gone
- `reconnect_participant(session_id, participant_id)` — DISCONNECTED → CONNECTED, restores ACTIVE from ABANDONED
- `get_session_participants(session_id)`

**Session lifecycle coupling:**
- `join_session` → CREATED or ABANDONED session transitions to ACTIVE
- `leave_session` → ends session + marks all remaining participants LEFT
- `disconnect_participant` → if last CONNECTED participant, session → ABANDONED + Redis TTL set
- `reconnect_participant` → if session was ABANDONED, session → ACTIVE + Redis TTL cleared

---

### Chat Domain

**Model:** `DomainChatMessage`

**Message types:** `USER` | `SYSTEM`

**Rules:**
- `ENDED` and `ABANDONED` sessions are read-only — `create_message` raises `SessionAlreadyEnded`.
- `LEFT` participants cannot send messages.
- System messages are generated automatically at every lifecycle event (JOIN, LEAVE, DISCONNECT, RECONNECT, SESSION_STARTED, SESSION_ENDED, SESSION_ABANDONED).
- Messages are immutable once saved. No edit or delete operations.

**Key service:** `ChatService`
- `create_message(session_id, content, sender_participant_id, message_type)` — validates and persists
- `get_messages(session_id, limit, offset)` — historical retrieval, chronological order

**System message pattern (Bug #1 fix):**
```python
# Inside a service transaction — FLUSH only (no commit yet)
payload = await flush_system_message(db_session, session_id, "content here")
pending_broadcasts.append((session_id, payload))

# After db_session.commit() —  THEN broadcast
for sid, p in pending_broadcasts:
    await broadcast_system_message_payload(sid, p)
```
This guarantees **persist-before-broadcast**: clients only receive messages that are durably committed.

---

### Presence & Real-Time Infrastructure

#### Redis Keys

| Key | Type | Purpose |
|---|---|---|
| `session:{id}:presence` | Hash | `participant_id → connection_status` |
| `session:{id}:active_connections` | Set | Active WebSocket connection UUIDs |
| `session:{id}:abandoned_expiry` | String (TTL) | 60s abandonment grace period marker |
| `session:{id}:pubsub` | Redis PubSub channel | Cross-instance event fan-out |

Redis is **ephemeral state only**. PostgreSQL is the source of truth. If Redis restarts:
- Presence data is lost (cosmetic — DB has ground truth).
- Abandonment TTL keys are lost — the lifecycle monitor will see ABANDONED sessions with no Redis key and immediately end them (correct behavior).

#### WebSocket Manager (`WebSocketManager`)

- Global singleton (`ws_manager`) in `websocket_manager.py`.
- Maintains `active_connections: Dict[session_id, List[WebSocket]]` in-process.
- Maintains `pubsub_tasks: Dict[session_id, asyncio.Task]` — one Redis PubSub listener per session.
- `broadcast_to_session(session_id, event_type, payload)` publishes to Redis channel.
- Redis subscriber task forwards messages to all local WebSocket connections.

> **⚠️ Multi-worker limitation:** PubSub tasks are in-process. In a multi-worker deployment (`uvicorn --workers N`), each worker maintains its own dict. Workers can publish to Redis, but only the worker with the subscriber task forwards to its local sockets. **Do not run multi-worker without fixing this first.**

#### WebSocket Endpoint

`GET /api/v1/sessions/{session_id}/ws?participant_id={uuid}`

**Connection lifecycle:**
1. Session validated (ENDED → close 4000).
2. If no `participant_id` → read-only viewer mode.
3. Participant validated (LEFT → close 4002, not found → close 4001).
4. If participant is DISCONNECTED → `reconnect_participant()` called.
5. WebSocket accepted, registered in `ws_manager` and Redis.
6. `PARTICIPANT_RECONNECTED` event broadcast.
7. Receive loop: handles `SEND_MESSAGE` events.
8. On disconnect (`finally`): `disconnect_participant()` called → handles ABANDONED transition automatically.

**Client → server message format:**
```json
{ "event": "SEND_MESSAGE", "data": { "content": "Hello" } }
```

**Server → client event format:**
```json
{ "event_type": "MESSAGE_RECEIVED", "payload": { "id": "...", "content": "...", ... } }
{ "event_type": "MESSAGE_SEND_ERROR", "payload": { "reason": "..." } }
{ "event_type": "PARTICIPANT_RECONNECTED", "payload": { "participant_id": "...", ... } }
{ "event_type": "PARTICIPANT_DISCONNECTED", "payload": { "participant_id": "...", ... } }
{ "event_type": "SESSION_ABANDONED", "payload": { ... } }
{ "event_type": "SESSION_ENDED", "payload": { ... } }
```

---

### Session Abandonment Monitor

`src/services/lifecycle_monitor.py` — started as an `asyncio.Task` at app startup.

- Polls every **5 seconds**.
- Queries PostgreSQL for all `ABANDONED` sessions.
- For each one: checks if `session:{id}:abandoned_expiry` key exists in Redis.
- If key is **gone** (TTL expired, default 60s): calls `session_service.end_session()` with `system_lifecycle_monitor` identity, clears Redis presence, broadcasts `SESSION_ENDED`.
- If session becomes ACTIVE before expiry: `reconnect_participant()` clears the Redis key.

---

## API Endpoints

All under prefix `/api/v1/sessions`.

### Session

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Create session (agent only, via `X-User-ID/Role` headers) |
| `GET` | `/` | List sessions (pagination + status filter) |
| `GET` | `/{session_id}` | Get session by ID |
| `POST` | `/validate-invite` | Validate an invite token |
| `POST` | `/{session_id}/end` | End session (idempotent) |
| `GET` | `/{session_id}/events` | Get all audit events |

### Participant

| Method | Path | Description |
|---|---|---|
| `POST` | `/{session_id}/participants/join` | Join session (201 new, 200 reconnect) |
| `POST` | `/{session_id}/participants/{id}/leave` | Leave session |
| `POST` | `/{session_id}/participants/{id}/disconnect` | Mark disconnected |
| `POST` | `/{session_id}/participants/{id}/reconnect` | Reconnect from disconnected |
| `GET` | `/{session_id}/participants` | List all participants |

### Chat

| Method | Path | Description |
|---|---|---|
| `GET` | `/{session_id}/messages` | Get chat history (pagination, up to 500) |

### WebSocket

| Method | Path | Description |
|---|---|---|
| `WS` | `/{session_id}/ws` | Real-time gateway (optional `?participant_id=uuid`) |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |

---

## Frontend Pages

| Route | File | Description |
|---|---|---|
| `/` | `app/page.tsx` | Landing — redirects to `/agent` |
| `/agent` | `app/agent/page.tsx` | Agent dashboard: create sessions, view history |
| `/join/[inviteToken]` | `app/join/[inviteToken]/page.tsx` | Customer invite landing: validates token, joins session |
| `/session/[sessionId]` | `app/session/[sessionId]/page.tsx` | Session room: full diagnostic UI |

### Session Room Features

- **Participant list** with connection status badges (CONNECTED / DISCONNECTED / LEFT)
- **Join Simulator Controller** — create participants via the API without a separate browser window
- **Chat Panel** (`ChatPanel.tsx`) — real-time message feed + composer
- **Diagnostic Event Log** — append-only audit timeline
- **Status badge** — CREATED (indigo) / ACTIVE (emerald) / ABANDONED (amber ⚠) / ENDED (grey)
- **Identity persistence** — participant identity stored in `localStorage` keyed by `vq_identity_{sessionId}_{userId|role}`, so page refreshes don't lose your identity

### WebSocket Behavior in Frontend

- Connects on mount (tied to `sessionId` only, not participant ID, to prevent reconnect loops).
- Captures `currentParticipantId` at the moment of opening (not reactive to state changes).
- `MESSAGE_RECEIVED` events → append to `chatMessages` state directly (no REST round-trip).
- `MESSAGE_SEND_ERROR` → sets error banner.
- All other events → `refreshRoomData()` (full REST sync).

### API Client (`api-client.ts`)

All API calls go through a typed `fetch` wrapper with error extraction. Methods:

```typescript
apiClient.createSession(agentId)
apiClient.listSessions()
apiClient.getSession(sessionId)
apiClient.validateInvite(inviteToken)
apiClient.endSession(sessionId, agentId)
apiClient.getSessionEvents(sessionId)
apiClient.joinSession(sessionId, userId, role, inviteToken?)
apiClient.leaveSession(sessionId, participantId)
apiClient.disconnectParticipant(sessionId, participantId)
apiClient.reconnectParticipant(sessionId, participantId)
apiClient.getSessionParticipants(sessionId)
apiClient.getChatMessages(sessionId)
```

---

## Database Schema

Tables: `sessions`, `participants`, `session_events`, `chat_messages`

### Key Constraints

- `participants(session_id, role)` — **UNIQUE** (one agent, one customer per session)
- `chat_messages.sender_participant_id` — FK to `participants` with `ON DELETE SET NULL` (messages survive participant deletion)
- All FK from child tables to `sessions` use `ON DELETE CASCADE`
- All primary keys are UUIDv4

### ORM Utilities

- `GUID` — custom `TypeDecorator` mapping to PostgreSQL `UUID` and SQLite `CHAR(36)`
- `SafeJSON` — maps to PostgreSQL `JSONB` and SQLite `JSON`

This is why tests run against SQLite (in-memory) without any schema changes.

---

## Test Architecture

```bash
uv run pytest -v
# 45 tests, ~3 seconds, zero external dependencies
```

| File | Coverage |
|---|---|
| `test_session_domain.py` | DomainSession state machine |
| `test_session_service.py` | SessionService with DB (SQLite) |
| `test_participant_domain.py` | DomainParticipant transitions |
| `test_participant_service.py` | ParticipantService full lifecycle |
| `test_participant_api.py` | REST endpoint integration |
| `test_api.py` | Session REST endpoint integration |
| `test_chat.py` | ChatService + REST + system messages |
| `test_realtime.py` | Redis presence operations |

Tests use a shared `conftest.py` fixture that creates a fresh SQLite database per test and an async HTTPX client pointing at the test app.

---

## What Was Broken & What Was Fixed

### Critical Bug (Root Cause of Broken Chat)

**`websockets` library was missing from `pyproject.toml`.**

Uvicorn requires `websockets` or `wsproto` for WebSocket support. Without it, every WebSocket upgrade request returned HTTP `404 Not Found` silently. Evidence from logs:
```
WARNING: No supported WebSocket library detected.
WARNING: Unsupported upgrade request.
GET /api/v1/sessions/.../ws HTTP/1.1" 404 Not Found
```
**Fix:** Added `websockets>=14.0` to `pyproject.toml`.

### Other Bugs Fixed

| Bug | Fix |
|---|---|
| System messages broadcast before DB commit (ghost messages on rollback) | Introduced `flush_system_message()` + `broadcast_system_message_payload()` pattern — broadcast fires only after `commit()` |
| Double disconnect broadcasts (service + routes.py `finally` block) | Removed explicit broadcasts from WS `finally` block; `disconnect_participant()` service handles everything |
| ABANDONED sessions accepting chat messages | Added `ABANDONED` to blocked statuses in `create_message()` |
| Reconnect via join returned HTTP 201 (wrong) | Returns HTTP 200 for reconnect, 201 for new join |
| WebSocket connection_id used Python memory address | Replaced `id(websocket)` with `uuid.uuid4()` |
| WS `useEffect` re-fired on every participant refresh | Deps changed to `[sessionId]` only; participant ID captured at open time |
| Participant identity lost on page refresh | `localStorage` keyed by `vq_identity_{sessionId}_userId/role` |
| ABANDONED status missing from TypeScript types | Added `'ABANDONED'` to `Session.status` and `ValidateInviteResponse.status` |
| ABANDONED had no distinct UI state | Amber badge `⚠ ABANDONED` added; ChatPanel shows amber "Chat paused" footer |

---

## Known Remaining Issues

These are documented and prioritised — **do not block LiveKit integration**:

### Medium Priority

1. **Multi-worker PubSub leak** — `WebSocketManager` uses in-process dicts. With `uvicorn --workers N`, each worker maintains its own subscriber tasks. Not a problem in single-worker Docker setup, but must be fixed before horizontal scaling. Fix: shared Redis-based connection registry.

2. **No WebSocket authentication** — WS connections accept any `participant_id` without a token. Before production: require a short-lived signed nonce generated at join time.

### Low Priority

3. **`get_abandoned_sessions()` is dead code** — `RedisPresenceService` has a SCAN-based method for abandoned sessions that's never called (lifecycle monitor uses DB query). Safe to delete.

4. **No message content length limit** — Chat service accepts any string length. Add `max_length` constraint to content field.

5. **`leave_session` can end CREATED sessions** — Technically the domain allows ending any non-ENDED session. Edge case only reachable via direct API call, not normal flow.

---

## What Comes Next: LiveKit Integration

The architecture is **ready for LiveKit**. No structural changes needed.

### Integration Points

#### 1. Token Generation — `join_session` hook

When `join_session()` succeeds, generate a LiveKit access token and return it to the participant.

```python
# In ParticipantService.join_session() — after saved_participant created:
livekit_token = await livekit_service.generate_token(
    room_name=str(session_id),          # session.id is the room name
    participant_identity=str(saved_participant.id),  # participant.id is identity
    participant_name=saved_participant.user_id,
    can_publish=True,
    can_subscribe=True,
)
# Return token alongside participant data
```

#### 2. Room Creation — `join_session` on first participant (CREATED → ACTIVE)

```python
# When session.activate() is called:
await livekit_service.create_room(room_name=str(session_id))
```

#### 3. Room Teardown — `end_session` hook

```python
# In SessionService.end_session() — before commit:
await livekit_service.delete_room(room_name=str(session_id))
```

#### 4. Participant Permissions by Role

```python
AGENT_PERMISSIONS = { can_publish: True, can_subscribe: True, can_publish_data: True }
CUSTOMER_PERMISSIONS = { can_publish: True, can_subscribe: True, can_publish_data: False }
```

#### 5. Schema Change Required

Add `livekit_room_sid` to the sessions table (LiveKit's server-side room ID for tracking).

```python
# migrations/xxxx_add_livekit_room_sid.py
op.add_column('sessions', sa.Column('livekit_room_sid', sa.String(255), nullable=True))
```

#### 6. API Response Change Required

`ParticipantResponse` (or a new `JoinResponse`) needs to include the LiveKit token:

```python
class JoinSessionResponse(BaseModel):
    participant: ParticipantResponse
    livekit_token: str  # Short-lived JWT for LiveKit SDK
    livekit_url: str    # LiveKit server URL for the client SDK
```

#### 7. Frontend Integration

The customer/agent receives `livekit_token` and `livekit_url` from the join response. Pass these to `@livekit/client-sdk-js` in the session room page.

### Recommended LiveKit Service File

Create `src/services/livekit_service.py`:
```python
from livekit import api as livekit_api

class LiveKitService:
    def __init__(self, host: str, api_key: str, api_secret: str):
        self.client = livekit_api.LiveKitAPI(host, api_key, api_secret)
    
    async def generate_token(self, room_name, participant_identity, ...) -> str: ...
    async def create_room(self, room_name) -> Room: ...
    async def delete_room(self, room_name): ...
```

Add to `Settings` in `config.py`:
```python
LIVEKIT_URL: str = os.getenv("LIVEKIT_URL", "wss://your-livekit-server")
LIVEKIT_API_KEY: str = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET: str = os.getenv("LIVEKIT_API_SECRET", "")
```

---

## Git History (recent)

```
7fd1ab6  Fixed a websocket dependency issue, and some UX issues
6cea3bd  (previous work — Chat Domain frontend integration)
...
```

---

## Quick Start Checklist for New Developer

```bash
# 1. Clone the repo
git clone https://github.com/Fusion831/VideoQuest
cd VideoQuest

# 2. Start everything
docker compose up --build -d

# 3. Verify health
curl http://localhost:8000/health
# → {"status": "healthy"}

# 4. Open frontend
open http://localhost:3000

# 5. Run tests
uv run pytest -v
# → 45 passed

# 6. Open Swagger
open http://localhost:8000/docs
```

---

*Handoff prepared 2026-06-13. System is clean, tested, and ready for LiveKit media integration.*

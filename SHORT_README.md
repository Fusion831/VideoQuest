# VideoQuest — Quick Start & Limitations Guide

This document is a condensed reference guide detailing the installation steps, environment configurations, and current system limitations of VideoQuest for hackathon judges and technical reviewers.

For a comprehensive deep dive into the architecture, design patterns, and database schemas, please refer to the main [README.md](file:///c:/Users/daksh/Projects/VideoQuest/README.md).

---

## 1. Environment Variables Configuration

Before launching the services, you must create a `.env` file at the root of the project to configure the service links and credentials:

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/videoquest
REDIS_URL=redis://localhost:6379/0
ENVIRONMENT=development
LIVEKIT_URL=http://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

---

## 2. Quick Start Setup

### Prerequisites
* Docker and Docker Compose installed.
* Alternatively, for manual local setup: Python 3.13 (`uv` manager recommended) and Node.js (v18+).

### Method A: Docker Compose (Recommended)
This starts the entire suite (PostgreSQL, Redis, LiveKit media server, FastAPI backend, Next.js frontend) in a single command. It automatically consumes the `.env` file created in Step 1.

```bash
# Start all containers in the background
docker compose up --build -d

# Verify backend health check
curl http://localhost:8000/health
# Expected Response: {"status": "healthy"}
```

#### Clean Database Reset
To wipe all PostgreSQL tables and Redis state:
```bash
docker compose down -v
docker compose up --build -d
```

### Method B: Manual Local Development

#### 1. Backend API Server
Requires PostgreSQL and Redis running locally.
```bash
# Sync Python packages and environment
uv sync

# Run database migrations
uv run alembic upgrade head

# Start Uvicorn development server
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

#### 2. Frontend Application
```bash
cd web
npm install
npm run dev
```

#### 3. LiveKit Server
```bash
livekit-server --config livekit.yaml
```

---

## 3. Ports and Endpoints

Once the application is running, you can interact with the components at the following local ports:

| Service | Protocol / Port | Target Address |
|---|---|---|
| **Frontend Web App** | HTTP (3000) | `http://localhost:3000` |
| **Backend REST API** | HTTP (8000) | `http://localhost:8000` |
| **Swagger UI Documentation** | HTTP (8000) | `http://localhost:8000/docs` |
| **LiveKit SFU Server** | HTTP (7880) | `http://localhost:7880` |
| **PostgreSQL Database** | TCP (5432) | `localhost:5432` |
| **Redis Cache & Pub/Sub** | TCP (6379) | `localhost:6379` |

---

## 4. Running the Test Suite
VideoQuest includes a comprehensive integration test suite running on an isolated in-memory SQLite database (no external database or Redis servers required).

```bash
uv run pytest -v
# Expected: 45 tests passed
```

---

## 5. Current System Limitations

The following architectural constraints are intentionally deferred in this hackathon prototype:

1. **Header-Based Authentication:** User identification and role enforcement (`AGENT` vs. `CUSTOMER`) rely on HTTP headers (`X-User-ID` and `X-User-Role`) rather than secure JWT or OAuth2 credentials.
2. **Single-Tenant Deployment:** There is no tenant isolation. All agents can view, access, and manage all support sessions globally.
3. **No Ticket Escalation or Queueing:** Support rooms are created and joined ad-hoc. The platform lacks support ticket queues, automatic agent assignment, or tier-based escalation policies.
4. **No Chat Attachment Uploads:** Real-time communications are restricted to text messages and video feeds. There is no support for uploading files, screenshots, or diagnostic logs.
5. **In-Process WebSocket Scaling Limit:** The backend routing manager (`WebSocketManager`) utilizes local, in-process loops to listen to Redis Pub/Sub events. In an auto-scaled production environment with hundreds of concurrent workers, this needs to be decoupled via a shared Redis session tracker to prevent subscription leaks.

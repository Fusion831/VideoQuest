# VideoQuest — Project Handoff

**Repo:** `Fusion831/VideoQuest`  
**Last Stable Commit:** `2c3ca12` — *UI/UX Overhaul & Security Gating*  
**System Status:** All 64 backend tests passing. Web app successfully compiles and builds.

---

## 1. Executive Summary

VideoQuest has been successfully transformed from a developer-facing diagnostic prototype into a production-grade, secure, and customer-centric support portal. 

All core workflows have been hardened to enforce **backend-authoritative security**:
- User identities and authorization roles are determined entirely via secure HTTP headers/JWT authentication.
- Media transitions and video call escalations are gated behind explicit state changes managed by the backend.
- The UI features a clean, chat-first experience matching modern service aesthetics (Notion, Linear, Zoom), keeping developer tools hidden and accessible only to authorized agents.

---

## 2. Updated Technology Stack

| Layer | Technology |
|---|---|
| **Backend Runtime** | Python 3.13, FastAPI, Uvicorn |
| **Package Manager** | `uv` (lock file: `uv.lock`) |
| **Database** | PostgreSQL 15 (asyncpg + SQLAlchemy 2.0 async) |
| **Cache / Pub-Sub** | Redis 7 (redis-py async) |
| **WebSocket Transport** | `websockets` 16.0 |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| **Containerisation** | Docker Compose (5 services: db, redis, livekit, backend, frontend) |
| **Testing** | pytest + pytest-asyncio, SQLite in-memory for testing isolation |

---

## 3. Key Core Workflows & Architectural Hardening

### A. Support Request Lifecycle
Instead of a client-controlled session generation flow, a secure support workflow is now driven entirely by the backend database state:
```
CREATED (Pending Queue) ──[Agent Accepts]──> ACTIVE (In Session) ──[Session Ended]──> ENDED (Read-Only)
```
1. **Creation:** Customers submit their display name and issue details via the landing page, creating a session with status `CREATED` and no assigned `agent_id`.
2. **Queueing:** Incoming requests are visible to logged-in agents on the Agent Dashboard under **Waiting Requests**.
3. **Acceptance:** When an agent accepts the request, the backend updates the session status to `ACTIVE`, assigns the `agent_id`, and automatically joins both participants.

### B. Backend-Authoritative Video Escalation Gating
To prevent unauthorized media streaming or privilege escalations:
- A new session field `video_escalation_status` tracks the call state: `NOT_STARTED` -> `REQUESTED` -> `ACTIVE`.
- Agents must explicitly click **Start Video Call**, triggering a state change to `REQUESTED` and pushing a real-time system notification.
- Customers receive a beautiful modal request to accept the video call.
- The React `MediaRoom` component remains completely unmounted and disconnected until `video_escalation_status` changes to `ACTIVE` on the backend, ensuring no premature or unauthorized media streams are established.

### C. Chat-First UI & Agent Developer Console
- **Customer View:** Highly minimalistic. Displays a chat stream, text composer, video connection boxes when a call is active, and a button to leave the call. No technical diagnostic widgets, tokens, or IDs are visible.
- **Agent View:** Features the same clean layout, but adds a collapsible **Developer Tools** panel at the bottom. This panel contains LiveKit status indicators, the system event log, and session metadata.

---

## 4. Database Schema Modifications

Automatic schema migrations are run via the application lifespan hook, injecting support fields into the SQLite and PostgreSQL engines:
1. `sessions.customer_name` (nullable string): Stores the customer's display name.
2. `sessions.issue_description` (nullable text): Stores the customer's support request details.
3. `sessions.video_escalation_status` (string, default `'NOT_STARTED'`): Gates access to the LiveKit rooms.
4. `sessions.agent_id` made **nullable** to support the unassigned queuing phase.

---

## 5. Endpoints & REST API

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/v1/sessions/request` | Public | Submit support request (creates session, joins customer, returns JWT) |
| `POST` | `/api/v1/sessions/{id}/accept` | Agent | Assigns agent and transitions session status to `ACTIVE` |
| `POST` | `/api/v1/sessions/{id}/request-video` | Agent | Initiates a video call request (status: `REQUESTED`) |
| `POST` | `/api/v1/sessions/{id}/accept-video` | Customer| Accept video call invitation (status: `ACTIVE`) |
| `POST` | `/api/v1/sessions/{id}/end` | Agent/Cust | Terminate the support session (idempotent, status: `ENDED`) |

---

## 6. Local Development and Testing

### Running Tests
To run the full suite of 64 unit and integration tests (which utilize an isolated in-memory SQLite database):
```bash
.venv\Scripts\pytest
```

### Running the Stack in Dev Mode (Host System)
1. **Backend Server:**
   ```bash
   .venv\Scripts\python -m uvicorn src.main:app --host 0.0.0.0 --port 8000
   ```
2. **Frontend App:**
   ```bash
   cd web
   npm run dev
   ```

---

## 7. Starting the App with Docker

To start the complete production-ready stack (including PostgreSQL, Redis, LiveKit, Python Backend, and Next.js Frontend):

```bash
# Clean build and start in detached mode
docker compose up --build -d

# Check running services
docker compose ps

# View backend logs
docker compose logs backend -f
```

*Handoff document prepared and finalized on June 13, 2026.*

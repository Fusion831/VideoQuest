# VideoQuest — Real-Time Video Support Platform

VideoQuest is a production-grade hackathon prototype designed to bridge the gap in technical customer service. By combining **real-time audio/video consultations**, **synchronized live chat**, and a **durable diagnostic event timeline**, VideoQuest empowers support agents to resolve customer issues with speed, clarity, and precision.

The system is built with a highly structured clean architecture, ensuring clear separation between core domain logic, infrastructure services, and the API/delivery layers.

---

## 1. Project Overview

### The Problem
Traditional customer support relies on asynchronous emails, stateless tickets, or voice-only phone calls. This leads to **"blind troubleshooting,"** where agents cannot see the system status or the user's screen. As a result, troubleshooting cycles suffer from:
* **High Mean-Time-to-Resolution (MTTR):** Unnecessary back-and-forth messages requesting screenshots, logs, or diagnostic reports.
* **Cognitive Load & Miscommunication:** Customers struggling to explain technical issues, and agents struggling to explain complex resolutions.
* **Lack of Historical Context:** Chat transcripts, presence logs, and diagnostic events are often fragmented across multiple services, preventing auditability.

### The Solution
VideoQuest provides a unified, real-time diagnostic workspace.
1. **Visual Diagnostics:** Live video/audio streams give agents immediate visual context of the customer's physical or digital environment.
2. **Synchronized Workspace:** Real-time text chat and system-generated audit events are displayed in a unified timeline.
3. **Durable Auditing:** Every session state change, connection state transition, and chat message is logged transactionally to a persistent database.

---

## 2. System Architecture

VideoQuest is built with a decoupled architecture. The frontend is powered by **Next.js (React 19)**, and the backend is served by **FastAPI (Python 3.13)**. State is split between **PostgreSQL** (durable relational data) and **Redis** (ephemeral status and Pub/Sub). Media streaming is offloaded to **LiveKit** via WebRTC.

```mermaid
graph TD
    %% Clients
    subgraph ClientLayer ["Client Layer"]
        Customer["Customer Browser (Next.js 16)"]
        Agent["Agent Browser (Next.js 16)"]
    end

    %% Edge & Auth
    subgraph GatewayLayer ["API Gateway & Security"]
        Auth["Authentication Layer (X-User-ID / Role Headers)"]
    end

    %% Backend Services
    subgraph ServiceLayer ["Backend Layer (FastAPI)"]
        API["FastAPI REST & WebSocket Gateway"]
        WSManager["WebSocket Manager (Local Registry)"]
        Monitor["Session Lifecycle Monitor (Async Task)"]
    end

    %% State & Storage
    subgraph StorageLayer ["Data & State Layer"]
        PG[(PostgreSQL Database)]
        Redis[(Redis 7 Cache / Pub-Sub)]
    end

    %% Media Server
    subgraph MediaLayer ["Real-Time Media (LiveKit)"]
        LiveKit["LiveKit SFU Server"]
    end

    %% Connections & Data Flow
    Customer -->|HTTP REST / WebSockets| Auth
    Agent -->|HTTP REST / WebSockets| Auth
    Auth --> API
    API -->|Read/Write ORM| PG
    API -->|Presence / Pub-Sub| Redis
    API -->|Session / Participant Service| WSManager
    WSManager -->|Pub-Sub Fan-out| Redis
    Monitor -->|Query Status| PG
    Monitor -->|Check Expired TTL| Redis

    %% Media Connections
    Customer <-->|WebRTC Media & Signaling| LiveKit
    Agent <-->|WebRTC Media & Signaling| LiveKit
    API -->|Token Gen / Room Admin API| LiveKit
```

### Data Flow
1. **Control and Configuration (HTTP REST):** Clients interact with FastAPI endpoints to create sessions, join rooms, and fetch historical timelines. All write operations go through domain services and are committed to PostgreSQL.
2. **Real-Time Event Stream (WebSockets):** Active chat messages, presence changes, and room state updates are distributed via persistent WebSocket connections.
3. **Cross-Worker Event Broadcast (Redis Pub/Sub):** When an event occurs on one API worker, it is published to Redis and fanned out to all active FastAPI instances to update connected WebSockets.
4. **High-Bandwidth Media Stream (WebRTC):** Audio and video traffic streams directly between client browsers and the LiveKit SFU server, minimizing CPU overhead on the API gateway.

---

## 3. Support Workflow Diagram

The session lifecycle is automated from creation through archiving, enforcing strict participant validation rules at every step.

```mermaid
graph TD
    Start([Customer Needs Support]) --> Request[Customer Requests Help / Support Ticket]
    Request --> Create[Agent Creates Support Session]
    Create --> Token[Invite Token Generated]
    Token --> JoinCustomer[Customer Joins Session via Invite Link]
    JoinCustomer --> Active[Session Transitioned to ACTIVE]
    Active --> ConnectWS[Establish WebSocket Presence & Chat]
    Active --> ConnectLK[Establish LiveKit WebRTC Video/Audio]
    ConnectWS & ConnectLK --> Support[Real-Time Chat & Video Support]
    Support --> Resolve[Issue Resolved by Agent]
    Resolve --> End[Session Ended & WebSocket Connections Closed]
    End --> Archive[Session Archived & Read-Only History Saved]
```

---

## 4. Real-Time Communication Flow

To support multiple backend instances, real-time message broadcasting uses Redis Pub/Sub to distribute frames across workers.

```mermaid
graph LR
    subgraph Customers ["Customer Client"]
        CB["Customer Browser"]
    end

    subgraph BackendWorker1 ["FastAPI Instance A"]
        WS1["WebSocket Conn A"]
    end

    subgraph PubSub ["Redis Pub/Sub Bus"]
        Channel["session:{id}:pubsub channel"]
    end

    subgraph BackendWorker2 ["FastAPI Instance B"]
        WS2["WebSocket Conn B"]
    end

    subgraph Agents ["Agent Client"]
        AB["Agent Browser"]
    end

    CB <=>|WS Frame: SEND_MESSAGE| WS1
    WS1 -->|Publish Event| Channel
    Channel -->|Fan-out Event| WS2
    WS2 <=>|WS Frame: MESSAGE_RECEIVED| AB
    
    %% Bidirectional flow indication
    AB <=>|WS Frame: SEND_MESSAGE| WS2
    WS2 -->|Publish Event| Channel
    Channel -->|Fan-out Event| WS1
    WS1 <=>|WS Frame: MESSAGE_RECEIVED| CB
```

1. **Client Send:** A client sends a message frame over their local WebSocket connection to their hosting FastAPI worker.
2. **Persist-Before-Broadcast:** The worker flushes and commits the message to PostgreSQL.
3. **Publish to Redis:** Once committed, the worker publishes the event payload to the session's Redis channel (`session:{session_id}:pubsub`).
4. **Fan-Out:** All FastAPI workers subscribing to that Redis channel receive the event and forward it to their locally connected clients.

---

## 5. Core Features

### Support Sessions
* **Lifecycle States:** Sessions progress through `CREATED` (initialized), `ACTIVE` (participants joined), `ABANDONED` (no active connections), and `ENDED` (terminal, read-only state).
* **Secure Invites:** Customers join via cryptographically secure, URL-safe invitation tokens (`secrets.token_urlsafe(32)`).

### Live Video Consultation
* **High Quality, Low Latency:** Integrates with LiveKit SFU using WebRTC to stream voice and video.
* **Dynamic Media Controls:** Independent mute/unmute and camera toggles for both agents and customers.

### Real-Time Synchronized Chat
* **Dual Message Types:** Supports standard `USER` chat messages and automated `SYSTEM` notifications.
* **Durable Storage:** Chat history is committed to PostgreSQL before broadcasting, preventing "ghost" messages.

### Participant Presence Tracking
* **Live Badges:** Status badges (`CONNECTED`, `DISCONNECTED`, `LEFT`) update in real time.
* **Local Identity Retention:** Client details are stored in `localStorage` keyed by session ID to survive browser refreshes.

### Audit Logging & Timeline
* **Session Events:** Every lifecycle change, participant join/reconnect, or termination is saved as a `DomainSessionEvent` in PostgreSQL, creating an immutable audit trail.

### History & Resolution Tracking
* **Historical Auditing:** Supports listing sessions, viewing durations, and reading chat/event history.
* **Idempotent Termination:** Safe session closing ensures clean cleanup and state preservation.

### Role-Based Permissions
* **Agent Permissions:** `CREATE_SESSION`, `END_SESSION`, `SEND_MESSAGE`, `JOIN_CALL`, and `VIEW_DIAGNOSTICS`.
* **Customer Permissions:** `SEND_MESSAGE` and `JOIN_CALL` only.

---

## 6. Technical Decisions & Trade-Offs

### FastAPI (Async ASGI, Python 3.13)
* **Rationale:** FastAPI's asynchronous routing is ideal for keeping persistent WebSocket connections open without consuming massive thread counts. Combined with Pydantic, it enforces schema verification at the entry boundary.
* **Trade-Off:** Writing asynchronous Python requires strict use of non-blocking libraries (e.g., `asyncpg` for PostgreSQL, `redis-py` async). Blocking CPU operations or sync database drivers would block the main event loop.

### PostgreSQL 15 (SQLAlchemy 2.0 Async)
* **Rationale:** Relational constraints (such as unique indexes mapping `(session_id, role)`) prevent multiple customers or agents from occupying the same slots in a support session.
* **Trade-Off:** Database schemas must be structured and migrated using Alembic, which is more rigid than schema-less databases (e.g., MongoDB), but guarantees relational integrity.

### Redis 7
* **Rationale:** Redis acts as the low-latency state manager for ephemeral presence flags (tracking WebSocket connection state) and coordinate inter-worker messaging.
* **Trade-Off:** If Redis restarts, temporary presence keys and the 60-second abandonment timer are lost. However, this is mitigated because PostgreSQL remains the source of truth, and clients can rebuild state upon reconnection.

### LiveKit WebRTC SFU
* **Rationale:** Peer-to-peer WebRTC does not scale well when poor network conditions require adaptive bitrate streaming. Offloading media to LiveKit SFU ensures consistent quality.
* **Trade-Off:** Incorporating an external media server adds operational complexity and requires managing LiveKit access tokens and server-side room states.

### WebSockets vs. HTTP Polling
* **Rationale:** WebSockets provide full-duplex communication with minimal overhead, allowing real-time chat and presence alerts to be delivered instantly.
* **Trade-Off:** WebSockets require managing connection lifecycles, reconnect back-offs, and horizontal scalability challenges that are not present in stateless HTTP APIs.

---

## 7. Reliability Decisions

### Presence Synchronization
To prevent discrepancies between WebSocket states and database records, the system uses a dual-write sync approach. WebSocket connection hooks update the database and Redis concurrently. If a connection drops, the disconnect handler catches it and registers the state change immediately.

### Reconnect Handling
If a client experiences network disruption, their status transitions from `CONNECTED` to `DISCONNECTED`. The session remains `ACTIVE` for a 60-second grace period. If the client reconnects within this window, their active socket is re-registered, and their status updates to `CONNECTED` without interrupting the session.

### Session Lifecycle & Abandonment Monitor
A background lifecycle service (`lifecycle_monitor.py`) polls PostgreSQL every 5 seconds. If all participants disconnect, the session transitions to `ABANDONED`, setting a 60-second TTL key in Redis. If the timer expires without a client reconnecting, the background monitor automatically changes the session status to `ENDED` and cleans up resources.

> [!WARNING]
> Once a session transitions to the terminal `ENDED` state, it becomes permanently immutable. No new participants can join, and no chat messages can be sent.

### Identity Ownership & Unique Slots
To prevent multiple agents or customers from disrupting a session, the database enforces a unique constraint on the participant table:
```sql
UNIQUE (session_id, role)
```
If a customer tries to join an active session while another customer is connected, the API rejects the request with a `ParticipantAlreadyJoined` error.

---

## 8. Scalability Discussion

```mermaid
graph TD
    ALB["Application Load Balancer"]
    
    subgraph Workers ["FastAPI App Cluster"]
        API_1["FastAPI Instance 1"]
        API_2["FastAPI Instance 2"]
    end
    
    subgraph CacheCluster ["Managed Redis (ElastiCache)"]
        RedisPubSub["Redis Pub/Sub Channel"]
        RedisCache["Redis Active Presence Cache"]
    end
    
    subgraph DBCluster ["Managed Database"]
        PgBouncer["PgBouncer Pooler"]
        PG_Prod[(PostgreSQL Primary)]
    end
    
    subgraph SFUCluster ["LiveKit SFU Cluster"]
        LK_Node_1["LiveKit SFU Node 1"]
        LK_Node_2["LiveKit SFU Node 2"]
    end

    %% Routing
    ALB -->|Sticky WS / Round-Robin REST| API_1
    ALB -->|Sticky WS / Round-Robin REST| API_2
    
    %% Cache Conns
    API_1 <--> RedisPubSub
    API_2 <--> RedisPubSub
    API_1 <--> RedisCache
    API_2 <--> RedisCache
    
    %% DB Conns
    API_1 --> PgBouncer
    API_2 --> PgBouncer
    PgBouncer --> PG_Prod
    
    %% LiveKit Conns
    API_1 -->|Admin API| SFUCluster
    API_2 -->|Admin API| SFUCluster
```

### Transitioning to Production
To scale VideoQuest horizontally in a production environment:

1. **Load Balancing:** Use an Application Load Balancer (ALB) like AWS ALB or Nginx configured with sticky sessions for WebSockets, or use stateless WebSockets with an external session registry.
2. **Horizontal API Scaling:** Deploy FastAPI instances in Docker containers managed by Kubernetes or AWS ECS.
3. **Addressing the PubSub Task Leak:** In the prototype, `WebSocketManager` listens to Redis Pub/Sub channels using in-process tasks. In a clustered deployment, this can cause redundant subscriptions. The solution is to use a distributed WebSocket orchestrator or run a separate connection registry service.
4. **Managed Database & Connection Pooling:** Use managed database services (e.g., AWS RDS PostgreSQL) with PgBouncer to manage connection limits during spikes.
5. **Managed Redis Cluster:** Use AWS ElastiCache for Redis in a clustered configuration to handle pub-sub traffic and active presence state.
6. **LiveKit SFU Clustering:** Run LiveKit in a multi-node configuration coordinated by a Redis cluster to distribute WebRTC media loads.

---

## 9. Setup Instructions

### Environment Variables
Create a `.env` file in the root directory:

| Variable | Default Value | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/videoquest` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection string |
| `ENVIRONMENT` | `development` | Runtime environment profile |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api/v1` | Frontend API target |
| `NEXT_PUBLIC_LIVEKIT_URL` | `ws://localhost:7880` | LiveKit public endpoint for WebRTC |
| `LIVEKIT_URL` | `http://livekit:7880` | Backend LiveKit API URL |
| `LIVEKIT_API_KEY` | `devkey` | LiveKit API Key |
| `LIVEKIT_API_SECRET` | `secret` | LiveKit API Secret |

---

### Docker Setup (Recommended)
The simplest way to run the entire stack is with Docker Compose. This starts PostgreSQL, Redis, LiveKit, the FastAPI backend, and the Next.js frontend.

```bash
# Clone the repository
git clone https://github.com/Fusion831/VideoQuest
cd VideoQuest

# Start all services
docker compose up --build -d

# Verify system health
curl http://localhost:8000/health
# Response: {"status": "healthy"}

# Access the services:
# - Frontend: http://localhost:3000
# - Backend API Docs: http://localhost:8000/docs
```

To perform a clean reset (wipe databases and cache):
```bash
docker compose down -v
docker compose up --build -d
```

---

### Local Development Setup (Manual)

#### Prerequisites
* Python 3.13 (Managed via `uv` package manager)
* Node.js v18+ & npm
* PostgreSQL & Redis instances running locally

#### 1. Backend Setup
```bash
# Install uv and sync dependencies
pip install uv
uv sync

# Apply database migrations
uv run alembic upgrade head

# Run the backend dev server
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# Run the test suite (uses SQLite in-memory, no external DB needed)
uv run pytest -v
```

#### 2. Frontend Setup
```bash
cd web

# Install node dependencies
npm install

# Run the development server
npm run dev
```

#### 3. LiveKit Setup
Download the LiveKit CLI and server, then start the server using the configuration file in the project root:
```bash
livekit-server --config livekit.yaml
```

---

## 10. Current Limitations

* **Header-Based Authentication:** The application uses headers (`X-User-ID` and `X-User-Role`) to simulate user identities rather than enforcing secure JWT or OAuth2 verification.
* **Single Tenant Deployment:** There is no tenant or organizational isolation; all agents can view all support sessions in the system.
* **No Ticket Escalation:** Support sessions are peer-to-peer. There is no support queue, automated ticket assignment, or escalation routing.
* **No Attachment Uploads:** The chat system only supports text. Users cannot upload screenshots, log files, or diagnostic attachments.
* **Basic Analytics:** While the database logs lifecycle events, there is no analytics dashboard for tracking SLA metrics or agent performance.

---

## 11. Future Vision

* **Secure Authentication & Identity Providers:** Replace header-based identity with JWT authentication and OAuth2 integration (e.g., Auth0, Okta, Microsoft Entra).
* **Support Routing & Queues:** Implement support queues where customers wait for the next available agent, with skill-based routing.
* **AI-Assisted Troubleshooting:** Integrated AI model to analyze chat messages and live video feeds to suggest solutions from internal wikis.
* **RAG-based Knowledge Base:** Quick search tool for agents to retrieve troubleshooting articles without leaving the chat panel.
* **Server-Side Session Recording:** Implement LiveKit Egress to record audio and video sessions for quality assurance and training.
* **File & Log Sharing:** Secure file storage integration (e.g., Amazon S3) to let customers upload log files and screenshots directly to the session timeline.

---

## 12. Repository Structure

```
VideoQuest/
├── src/                        # Backend Application Source
│   ├── main.py                 # FastAPI Application Lifecycle & Router Initialization
│   ├── core/
│   │   ├── config.py           # Application Settings and Env Configurations
│   │   ├── exceptions.py       # Domain-Specific App Exceptions
│   │   ├── identity.py         # Lightweight Identity Abstraction & Role Permissions
│   │   └── logging.py          # Structured Logger Setup
│   ├── domain/
│   │   ├── models.py           # Domain DomainSession, DomainParticipant, DomainChatMessage
│   │   └── events.py           # Domain Events (SessionEventType Enum)
│   ├── infrastructure/
│   │   ├── database.py         # Async Database Engine and Session Factory
│   │   ├── models.py           # SQLAlchemy Declarative ORM Models
│   │   ├── repositories.py     # Clean Architecture Repositories (Data Access Layer)
│   │   ├── redis.py            # Redis Presence and Connection State Management
│   │   └── websocket_manager.py# WebSocket Routing and Redis Pub/Sub Subscription Manager
│   ├── services/
│   │   ├── session_service.py  # Session Domain Workflows (Create, Get, List, End)
│   │   ├── participant_service.py # Participant Connection & Lifecycle Management
│   │   ├── chat_service.py     # Chat message persistence and formatting helpers
│   │   └── lifecycle_monitor.py# Background Task: Auto-terminates abandoned rooms
│   └── api/
│       ├── dependencies.py     # FastAPI Dependency Injections (Auth, Services)
│       ├── routes.py           # REST Controllers & WebSockets Gateways
│       └── schemas.py          # Pydantic Schemas for Requests and Responses
├── web/                        # Frontend Application Source (Next.js 16)
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx        # Entry Point (Redirects to dashboard)
│   │   │   ├── agent/          # Agent View (Session creation and history list)
│   │   │   ├── join/           # Customer invite landing page
│   │   │   └── session/        # Unified Diagnostic Room Page (WS, Chat, Video)
│   │   ├── components/
│   │   │   └── ChatPanel.tsx   # Live chat feed and message input panel
│   │   └── lib/
│   │       ├── types.ts        # Shared TypeScript Interfaces for API responses
│   │       └── api-client.ts   # Axios/Fetch Wrapper calling FastAPI endpoints
├── migrations/                 # Alembic Database Migration History
├── tests/                      # Integration Test Suite
│   ├── conftest.py             # SQLite In-Memory Database Fixtures & Test Client Setup
│   ├── test_session_domain.py  # Unit tests for the Session state machine
│   ├── test_session_service.py # Service-level integration tests
│   └── test_realtime.py        # Redis presence integration tests
├── Dockerfile.backend          # Multi-Stage Docker Build for Python Runtime
├── docker-compose.yml          # Container configuration for DB, Redis, Backend, Frontend, and LiveKit
├── pyproject.toml              # Project dependencies managed via `uv`
└── livekit.yaml                # LiveKit Server Local Configuration file
```

---

## 13. Demo Walkthrough

### Step 1: Agent Initialization
1. Navigate to the Agent Dashboard at `http://localhost:3000/agent`.
2. The agent is initialized (simulating user credentials from headers). The page displays the active and historical support sessions dashboard.

### Step 2: Create a Session
1. Click the **"New Support Session"** button on the dashboard.
2. The backend generates a new session in the `CREATED` state, inserts it into PostgreSQL, and returns a secure customer invite link.

### Step 3: Customer Joins
1. Copy the customer invitation URL and open it in a new browser tab.
2. The landing page validates the token, displays the invitation metadata, and prompts the customer to join.
3. Upon clicking **"Join Session"**, the customer joins, and the session status updates to `ACTIVE`.

### Step 4: Active Communication
1. Both windows establish persistent WebSockets connections.
2. As soon as the customer joins, an automated `SYSTEM` message announces their arrival in the chat window.
3. The participants can exchange text messages in real time. The video connection is established in parallel via LiveKit WebRTC.

### Step 5: Simulating Reconnection
1. Close the customer's browser tab.
2. The agent's dashboard shows the customer's badge transition from `CONNECTED` to `DISCONNECTED`, and the session status updates to `ABANDONED` with a 60-second countdown.
3. If the customer reopens the invitation link within the 60-second window, their connection status returns to `CONNECTED`, and the timer is cleared.

### Step 6: Session Resolution
1. Once the troubleshooting is complete, the agent clicks **"End Session"**.
2. The session transitions to `ENDED`.
3. The WebSocket connections are closed, and both views display a read-only historical summary of the chat and event log.

---

## 14. Conclusion

VideoQuest demonstrates a robust, real-time diagnostic workspace. Its clean architecture separation guarantees that the platform remains easily maintainable, and the use of Redis Pub/Sub ensures a path forward for horizontal scalability. The database constraints, background lifecycle monitors, and state machines ensure that support operations are secure, auditable, and reliable.
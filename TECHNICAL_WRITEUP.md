# VideoQuest — Architectural & Technical Writeup

VideoQuest is a real-time, video-assisted support platform designed to provide a unified diagnostic workspace for agents and customers. This document details the core architectural decisions, concurrency models, and state machines that guarantee the platform's reliability and scalability.

---

## 1. Architectural Patterns & Layering
VideoQuest adheres to **Clean Architecture** and **Domain-Driven Design (DDD)** principles. The codebase is strictly partitioned into distinct layers to decouple the business logic from delivery mechanisms and databases:

1.  **Domain Layer (`src/domain/`)**: The core of the system. Contains pure business logic, domain models (`DomainSession`, `DomainParticipant`, `DomainChatMessage`), and domain events (`DomainSessionEvent`). It has zero external dependencies (no frameworks, no ORMs).
2.  **Infrastructure Layer (`src/infrastructure/`)**: Contains implementations of repositories for data access, Redis client drivers for volatile presence tracking, and the in-process WebSocket connection manager. This layer translates database records to domain aggregates.
3.  **Application/Service Layer (`src/services/`)**: Orchestrates transaction boundaries, executes use cases, coordinates between repositories, and fires events. It includes the background lifecycle monitoring daemon.
4.  **API/Delivery Layer (`src/api/`)**: Built on FastAPI. Enforces boundaries via dependency injection and Pydantic schemas, routing HTTP requests and handling WebSocket handshakes.

---

## 2. Finite State Machines (FSM)

The platform guarantees consistency by enforcing strict state transitions at the domain model level.

### Session State Machine
A session's status changes depending on active participant interactions:

```
[ CREATED ] ──(First Join)──> [ ACTIVE ] ──(All Disconnect)──> [ ABANDONED ]
     │                              │                                 │
     │                              ├─────────(Agent Ends)────────────┤
     │                              │                                 ▼
     └──────────────────────────────┴───────────────────────────> [ ENDED ] (Terminal)
```

*   **CREATED**: The session has been allocated by an agent, but the customer has not yet entered.
*   **ACTIVE**: At least one participant is actively connected.
*   **ABANDONED**: All participants have disconnected. The background lifecycle monitor starts a 60-second Redis TTL grace period. Reconnection resets the state to `ACTIVE` and clears the timer.
*   **ENDED**: The terminal state. The session is closed permanently. All WebSocket channels are torn down, and the record becomes read-only.

### Participant Connection State Machine
To track active status independently of session progression, each participant maintains a connection status:

```
[ CONNECTED ] <──(Keep-Alive Lost / Close)──> [ DISCONNECTED ]
       │                                             
       └────────────────(Exit Click)───────────────> [ LEFT ] (Terminal)
```

*   **CONNECTED**: The user has an active WebSocket gateway connection.
*   **DISCONNECTED**: The connection dropped due to network issues or tab closure. The participant can return.
*   **LEFT**: The user explicitly clicked "Leave." This is a terminal state. The participant slot cannot be reused.

---

## 3. Concurrency & Reliability Decisions

### The Persist-Before-Broadcast Pattern
In real-time environments, a common bug occurs when an event (such as a chat message) is broadcast to active connections before it is successfully committed to the database. If the database transaction fails (e.g., due to constraint violations or network dropouts), clients view "ghost" messages that do not exist in the session history.

VideoQuest solves this by enforcing a strict transactional sequence in the service layer:
1.  **Flush**: The database session flushes data to verify constraints.
2.  **Commit**: The transaction is committed to PostgreSQL.
3.  **Broadcast**: Only after a successful commit is the payload pushed to the Redis Pub/Sub channel for distribution.

### Decoupled Control and Media Channels
WebRTC connections are CPU-intensive and susceptible to transient network interference. VideoQuest decouples the **control plane** (WebSockets for chat, events, and presence) from the **media plane** (LiveKit SFU for WebRTC audio/video).
*   If a user's WebRTC stream drops, LiveKit handles sub-second ICE restarts without interrupting the text chat or changing the participant's status to `DISCONNECTED`.
*   If the WebSocket connection drops, the client retains their media state while the frontend back-off algorithm re-establishes the WebSocket connection.

---

## 4. Real-Time Routing & Scalability

```
Client Browser (A)  <== WS ==>  FastAPI Worker (A)  ──>  Redis Pub/Sub
                                                              │
                                                              ▼
Client Browser (B)  <== WS ==>  FastAPI Worker (B)  <──  Redis Sub Task
```

### WebSocket Gateway & Redis Pub/Sub Fan-Out
To scale the API layer horizontally across multiple Uvicorn worker instances:
1.  **Local Connection Tracking**: Each FastAPI worker maintains an in-memory dictionary of its active local WebSocket connections.
2.  **Redis Pub/Sub Bus**: When a worker processes a message, it commits it to PostgreSQL and publishes the event to Redis.
3.  **Broadcast Propagation**: Every worker runs a background Redis subscriber task that listens to the channel. When an event is received from Redis, the worker propagates the frame to all its locally connected clients.
4.  This architecture allows workers to scale horizontally without losing real-time event synchronization.

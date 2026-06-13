# ARCHITECTURE_DECISIONS.md

# Architecture Decision Records (ADR)

This document records major architectural decisions for the AtomQuest Hackathon Real-Time Video Support Platform.

The purpose is to ensure:

* Consistency across contributors
* Clear engineering rationale
* Traceable design decisions
* Easier onboarding
* Stronger architecture review during judging

---

# ADR-001

## Title

Backend Framework Selection

## Decision

Use FastAPI as the primary backend framework.

## Status

Accepted

## Alternatives Considered

### Django

Pros

* Mature ecosystem
* Admin panel included

Cons

* Heavyweight
* Slower development for realtime systems
* More boilerplate than required

---

### Flask

Pros

* Lightweight

Cons

* Requires significant setup
* Missing many modern features out of the box

---

### NestJS

Pros

* Excellent architecture
* Strong TypeScript support

Cons

* Team expertise primarily in Python
* Increased development overhead

---

## Rationale

FastAPI provides:

* Async support
* High performance
* Type safety through Pydantic
* Automatic OpenAPI generation
* Excellent WebSocket support
* Rapid development speed

This aligns with hackathon constraints while maintaining production-grade architecture.

---

# ADR-002

## Title

Database Selection

## Decision

Use PostgreSQL as the primary database.

## Status

Accepted

## Alternatives Considered

### MongoDB

Pros

* Flexible schema

Cons

* Session relationships are strongly structured
* Audit trails benefit from relational design

---

### SQLite

Pros

* Very simple setup

Cons

* Poor concurrency characteristics
* Less representative of production deployment

---

## Rationale

The platform contains strongly related entities:

* Sessions
* Participants
* Messages
* Events
* Recordings

Relational modeling provides:

* Data integrity
* Foreign key enforcement
* Easier querying
* Better auditability

PostgreSQL is also widely understood and scalable.

---

# ADR-003

## Title

Caching and Presence Layer

## Decision

Use Redis.

## Status

Accepted

## Alternatives Considered

### Database Only

Pros

* Simpler architecture

Cons

* Presence updates become expensive
* Increased database load

---

## Rationale

Redis will store:

* Active session state
* Presence information
* Reconnect windows
* Temporary signaling state

Benefits:

* Low latency
* Fast lookups
* Reduced database pressure

Persistent history remains in PostgreSQL.

---

# ADR-004

## Title

Media Architecture

## Decision

Use self-hosted LiveKit.

## Status

Accepted

## Alternatives Considered

### Twilio Video

Rejected.

Reason:

Third-party hosted video APIs are explicitly prohibited.

---

### Agora

Rejected.

Reason:

Third-party hosted video APIs are explicitly prohibited.

---

### Daily

Rejected.

Reason:

Third-party hosted video APIs are explicitly prohibited.

---

### Pure Browser Peer-to-Peer WebRTC

Rejected.

Reason:

Problem statement explicitly requires media routing through a server.

Peer-to-peer media does not satisfy requirements.

---

### Mediasoup

Pros

* Highly customizable
* Production-grade

Cons

* Significant implementation complexity
* Higher engineering cost

---

## Rationale

LiveKit provides:

* SFU architecture
* Server-routed media
* Reconnect support
* Recording support
* Participant management
* Self-hosted deployment

This satisfies challenge constraints while minimizing implementation risk.

---

# ADR-005

## Title

Architecture Style

## Decision

Use modular service-oriented architecture.

## Status

Accepted

## Structure

API Layer

↓

Application Services

↓

Domain Models

↓

Repositories

↓

Infrastructure

---

## Rationale

Separates:

* Business logic
* Persistence
* Transport concerns
* Infrastructure concerns

Improves:

* Testability
* Maintainability
* Scalability

---

# ADR-006

## Title

Session State Model

## Decision

Use explicit state machines.

## Status

Accepted

## Session States

CREATED

ACTIVE

ENDED

---

## Participant States

CONNECTED

DISCONNECTED

LEFT

---

## Recording States

NOT_STARTED

RECORDING

PROCESSING

READY

FAILED

---

## Rationale

Explicit state transitions reduce:

* Edge-case bugs
* Invalid transitions
* Inconsistent behavior

State changes become predictable and auditable.

---

# ADR-007

## Title

Event Logging Strategy

## Decision

Maintain a Session Events table.

## Status

Accepted

## Event Types

SESSION_CREATED

SESSION_STARTED

SESSION_ENDED

PARTICIPANT_JOINED

PARTICIPANT_LEFT

PARTICIPANT_DISCONNECTED

PARTICIPANT_RECONNECTED

CHAT_MESSAGE_SENT

RECORDING_STARTED

RECORDING_STOPPED

RECORDING_READY

---

## Rationale

A dedicated event stream enables:

* Session history
* Audit trails
* Debugging
* Admin dashboards
* Analytics

without requiring duplicated logic.

---

# ADR-008

## Title

API Design Style

## Decision

REST + WebSocket hybrid architecture.

## Status

Accepted

## REST Responsibilities

Session creation

Session retrieval

Session history

Recording metadata

Administrative operations

---

## WebSocket Responsibilities

Presence updates

Chat messages

Realtime notifications

Participant state updates

Signaling coordination

---

## Rationale

REST is well-suited for persistent resources.

WebSockets are required for realtime communication.

Using both provides a clear separation of responsibilities.

---

# ADR-009

## Title

Recording Storage

## Decision

Use S3-compatible object storage.

## Status

Accepted

## Local Development

MinIO

---

## Production

Any S3-compatible provider

---

## Rationale

Recordings are large binary assets.

Object storage is a better fit than relational databases.

Improves:

* Scalability
* Retrieval
* Cost efficiency

---

# ADR-010

## Title

Frontend Framework

## Decision

Use Next.js with TypeScript.

## Status

Accepted

## Alternatives Considered

### React SPA

Pros

* Simpler

Cons

* Less structure
* Harder long-term organization

---

### Vue

Pros

* Good developer experience

Cons

* Team preference favors React ecosystem

---

## Rationale

Provides:

* Strong TypeScript support
* Excellent ecosystem
* Fast development
* Clean component architecture

Frontend remains secondary to backend functionality.

---

# ADR-011

## Title

Primary Engineering Priorities

## Decision

Prioritize engineering effort in the following order:

1. Session Lifecycle
2. Participant Lifecycle
3. Persistence
4. Realtime Infrastructure
5. Media Routing
6. Chat
7. Reconnect Handling
8. Recording
9. Dashboard
10. Observability

## Rationale

The judging rubric heavily rewards:

* Functionality
* Reliability
* Architecture
* Code Quality

A reliable platform scores higher than a feature-rich but unstable one.

---

# ADR-012

## Title

Definition of Done

A feature is considered complete only when:

* Functionality works
* Edge cases handled
* Permissions enforced
* State persisted
* Errors surfaced correctly
* Code documented
* Tests written where practical

A demo-only implementation is not considered complete.

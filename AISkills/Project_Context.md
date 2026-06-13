# Project_Context.md

## Project Name

Mike Support

## Hackathon

AtomQuest Hackathon 1.0 Grand Finale

---

# Problem Statement Summary

Customer support teams often struggle to resolve issues through voice calls alone.

Support interactions frequently require visual context:

* Device troubleshooting
* Product inspection
* UI walkthroughs
* Installation verification

The goal is to build a browser-based real-time video support platform.

The platform must allow:

* Agents to create support sessions
* Customers to join using invite links
* Real-time audio/video communication
* In-call chat
* Session persistence
* Post-session review

Media must be routed through infrastructure operated by the team.

Third-party hosted video platforms are prohibited.

---

# Product Vision

A lightweight support platform optimized for:

* One support agent
* One customer

during a support interaction.

This is NOT:

* Zoom
* Google Meet
* Microsoft Teams

The system is focused specifically on support workflows.

---

# Target Users

## Primary User

Support Agent

Responsibilities:

* Create support sessions
* Share invite links
* Conduct troubleshooting calls
* Review session history
* Start and stop recordings

---

## Secondary User

Customer

Responsibilities:

* Join support sessions
* Participate in calls
* Send chat messages

Customers cannot:

* Create sessions
* End sessions
* Start recordings

---

# Functional Requirements

## Session Management

Agent can create session.

Agent receives invite token.

Customer joins through invite.

System validates invite.

System tracks active participants.

System persists session history.

System stores:

* join times
* leave times
* session duration

Agent or participant may end session.

System closes active connections cleanly.

---

## Audio and Video

Real-time communication.

Two-way audio.

Two-way video.

Media routed through self-hosted server.

No direct peer-to-peer media.

Participant controls:

* mute microphone
* unmute microphone
* disable camera
* enable camera

---

## In-Call Chat

Real-time message delivery.

Messages persisted.

Messages retrievable after session.

Messages linked to session.

---

## Access Control

Role enforcement required.

Agent permissions:

* create session
* end session
* recording controls

Customer permissions:

* join session
* participate

Invite validation required.

Expired or invalid invites rejected.

---

# Planned Bonus Features

## Reconnect Handling

Temporary disconnects should not destroy session state.

Grace period:

30-60 seconds.

Reconnect should restore participant.

Session should continue seamlessly.

---

## Call Recording

Agent starts recording.

Agent stops recording.

Recording lifecycle:

NOT_STARTED
RECORDING
PROCESSING
READY

Recording downloadable after processing.

---

# Architecture Goals

Primary goals:

1. Reliability
2. Correctness
3. Low latency
4. Maintainability
5. Scalability

---

# High Level Components

## API Layer

Responsible for:

* HTTP endpoints
* WebSocket endpoints
* Authentication
* Validation

No business logic.

---

## Session Service

Responsible for:

* Creating sessions
* Ending sessions
* Invite validation
* Session lifecycle

---

## Participant Service

Responsible for:

* Join
* Leave
* Disconnect
* Reconnect

---

## Chat Service

Responsible for:

* Message delivery
* Message persistence
* Chat history

---

## Recording Service

Responsible for:

* Recording lifecycle
* Metadata
* File retrieval

---

## Media Service

Responsible for:

* Integration with SFU
* Participant media state
* Call state

---

# Domain Models

## Session

Fields:

id
invite_token
status
created_at
started_at
ended_at
agent_id

---

## Participant

Fields:

id
session_id
role
joined_at
left_at
connection_status

---

## ChatMessage

Fields:

id
session_id
sender_id
content
created_at

---

## SessionEvent

Fields:

id
session_id
event_type
timestamp
metadata

---

## Recording

Fields:

id
session_id
status
file_path
started_at
ended_at

---

# Event Types

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

# Non-Functional Requirements

## Reliability

System must gracefully handle:

* Invalid invites
* Duplicate joins
* Session expiration
* Disconnects
* Browser refreshes

---

## Security

Enforce role permissions.

Validate invite tokens.

Never expose unauthorized session data.

---

## Performance

Low latency communication.

Fast session creation.

Fast join flow.

Efficient persistence.

---

## Maintainability

Strong typing.

Clear module boundaries.

Documented APIs.

Consistent naming conventions.

Minimal technical debt.

---

# Current Development Priority

Priority 1

Session Lifecycle

Priority 2

Participant Lifecycle

Priority 3

Persistence

Priority 4

WebSocket Infrastructure

Priority 5

Media Routing

Priority 6

Chat

Priority 7

Reconnect Handling

Priority 8

Recording

Priority 9

Admin Dashboard

Priority 10

Observability

No frontend optimization should occur until core backend functionality is stable.

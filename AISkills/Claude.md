# CLAUDE.md

## Project Overview

This project is being built for AtomQuest Hackathon 1.0.

The objective is NOT to build a generic video conferencing application.

The objective is to build a Real-Time Video Support Platform for customer support scenarios.

The official problem statement is the source of truth.

When making architectural or implementation decisions:

1. Follow the problem statement.
2. Prioritize functionality over feature count.
3. Prioritize reliability over UI polish.
4. Prioritize maintainability over shortcuts.
5. Avoid unnecessary complexity.

---

## Core Principles

### 1. Reliability First

A working end-to-end support session is more important than additional features.

Always preserve:

* Session integrity
* Participant state
* Access control
* Data persistence

before adding new functionality.

---

### 2. Backend Before Frontend

Frontend exists to expose backend functionality.

Do not introduce frontend abstractions that force backend redesigns.

Backend contracts should be established first.

---

### 3. Domain-Driven Design

Business logic should live in services and domain layers.

Avoid placing business logic in:

* API routes
* Controllers
* UI components

---

### 4. Explicit State Management

All session state transitions must be explicit.

Example:

Session

CREATED
ACTIVE
ENDED

Participant

CONNECTED
DISCONNECTED
LEFT

Recording

NOT_STARTED
RECORDING
PROCESSING
READY

Never rely on implicit state.

---

### 5. Event-Oriented Architecture

Important actions should generate events.

Examples:

SESSION_CREATED

PARTICIPANT_JOINED

PARTICIPANT_LEFT

PARTICIPANT_RECONNECTED

CHAT_MESSAGE_SENT

RECORDING_STARTED

RECORDING_STOPPED

CALL_ENDED

Events should be persisted whenever practical.

---

### 6. Security Requirements

Always enforce role permissions.

Agent capabilities:

* Create sessions
* End sessions
* Start recording
* Stop recording

Customer capabilities:

* Join sessions
* Participate in calls
* Send chat messages

Customers must never gain agent privileges.

Invite links must always be validated.

---

### 7. Code Quality Standards

Use:

* Type hints
* Clear naming
* Small functions
* Explicit return types
* Docstrings for public APIs

Avoid:

* Global state
* Hidden side effects
* Large God classes
* Business logic in routes

---

### 8. Performance Priorities

Order of importance:

1. Stable video/audio
2. Session correctness
3. Low latency
4. Clean architecture
5. UI polish

Never sacrifice correctness for cosmetic improvements.

---

### 9. Documentation Requirements

When creating new modules:

Always document:

* Purpose
* Inputs
* Outputs
* Failure cases
* State transitions

Assume future contributors have never seen the project before.

---

### 10. Decision Framework

When multiple solutions exist:

Choose the solution that:

1. Satisfies hackathon requirements.
2. Produces a reliable demo.
3. Is maintainable.
4. Can scale to multiple sessions.
5. Can be explained clearly to judges.

Avoid implementing features solely because they seem impressive.

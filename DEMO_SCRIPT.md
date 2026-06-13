# VideoQuest — 3-Minute Presentation & Demo Script

This script is structured for a **2.5 to 3-minute video presentation** or live demo tailored for hackathon judges and technical reviewers. It focuses on the architectural design decisions and the user experience.

---

## ⏳ Script Timeline & Narration

### Part 1: Intro & System Architecture (0:00 - 0:45)

**[Visual: Display the main Architecture Diagram from README.md]**

*   **Speaker:** "Hi everyone, welcome to the demo of VideoQuest—a real-time, video-assisted support platform designed to eliminate 'blind troubleshooting' in customer service. Before jumping into the web interface, let's look at the underlying architecture."
*   **Speaker:** "VideoQuest uses a clean, decoupled design. The frontend is built on **Next.js 16** and **React 19**, while the backend is powered by **FastAPI** running **Python 3.13**."
*   **Speaker:** "We split our application state strategically: **PostgreSQL** serves as our source of truth for transactional data and historical logs, while **Redis** acts as an ephemeral cache for tracking active connections. For real-time event broadcasting across backend nodes, we utilize a **Redis Pub/Sub** bus."
*   **Speaker:** "Finally, all high-bandwidth WebRTC video and audio streams are offloaded directly to a **LiveKit SFU** server. This keeps our main API gateway lightweight and optimized for event-driven transactions."

---

### Part 2: Agent Dashboard & Session Creation (0:45 - 1:30)

**[Visual: Switch screen share to the Agent Dashboard page at `/agent`]**

*   **Speaker:** "Here is the Agent Dashboard. From here, agents can see historical diagnostics, session durations, and active troubleshooting rooms."
*   **Speaker:** "To demonstrate the workflow, I'll simulate creating a new support session. Clicking 'New Support Session' sends a POST request, creating a session in the `CREATED` state. The backend generates a secure, URL-safe invitation token."
*   **Speaker:** "I'll copy this invitation link and open it in a side-by-side window to simulate the customer joining."

---

### Part 3: Live Sync, Presence, & Reliability (1:30 - 2:30)

**[Visual: Show Agent and Customer windows side-by-side. Click 'Join Session' in the customer window]**

*   **Speaker:** "When the customer joins, the session state immediately transitions from `CREATED` to `ACTIVE`. This triggers an automated system event on our timeline, announcing the customer's arrival."
*   **Speaker:** "Let's send a chat message. Under the hood, VideoQuest enforces a **persist-before-broadcast** transactional pattern. The message is committed to PostgreSQL before it is published to the Redis Pub/Sub channel. This ensures no 'ghost' messages appear in the client view if a database commit fails."
*   **Speaker:** "Now let's test reliability. If the customer suffers a network drop and closes their window... **[Visual: Close the customer tab]** ...the agent window instantly shows the customer status transition to `DISCONNECTED` and the session state shifts to `ABANDONED`."
*   **Speaker:** "We have a background lifecycle monitor polling every 5 seconds. It sets a 60-second grace period in Redis. If the customer reopens the tab before the timer expires... **[Visual: Re-open the customer tab]** ...their state transitions back to `CONNECTED` and the session returns to `ACTIVE`."

---

### Part 4: Resolution & Conclusion (2:30 - 3:00)

**[Visual: Click 'End Session' in the Agent window]**

*   **Speaker:** "Once the issue is resolved, the agent ends the session. The status changes to `ENDED`, which is a terminal, immutable state. The WebSockets are closed, and both the agent and customer are presented with a read-only historical timeline of the session."
*   **Speaker:** "By combining real-time WebSockets, robust state machines, Redis pub-sub routing, and LiveKit WebRTC media streams, VideoQuest delivers an audited, reliable support environment."
*   **Speaker:** "Thank you for watching!"

---

## 💡 Quick Tips for the Presenter

1.  **Preparation:** Pre-arrange your browser windows side-by-side (Agent on the left, Customer on the right) before beginning the recording.
2.  **Highlighting the Code:** When explaining *persist-before-broadcast* or *session lifecycle monitoring*, briefly reference that these features are backed by `pytest` coverage to assure the judges of code stability.
3.  **Delivery Tone:** Maintain a confident, engineering-first tone. Avoid marketing speak; focus on the technical details (e.g., schemas, Pub/Sub mechanisms, state transitions).

import {
  Session,
  SessionEvent,
  Participant,
  ValidateInviteResponse,
  SessionListResponse,
  ChatMessage,
} from './types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

async function fetchJson<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Set JSON headers by default
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    let errorMessage = 'An error occurred';
    try {
      const errorData = await response.json();
      errorMessage = errorData.detail || errorMessage;
    } catch {
      errorMessage = response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  /**
   * Sessions
   */
  async createSession(agentId: string): Promise<Session> {
    return fetchJson<Session>('/sessions/', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId }),
      headers: {
        'X-User-ID': agentId,
        'X-User-Role': 'agent',
      },
    });
  },

  async getSessions(status?: string): Promise<SessionListResponse> {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return fetchJson<SessionListResponse>(`/sessions/${query}`);
  },

  async getSession(sessionId: string): Promise<Session> {
    return fetchJson<Session>(`/sessions/${sessionId}`);
  },

  async endSession(sessionId: string, agentId: string): Promise<Session> {
    return fetchJson<Session>(`/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: {
        'X-User-ID': agentId,
        'X-User-Role': 'agent',
      },
    });
  },

  async getSessionEvents(sessionId: string): Promise<SessionEvent[]> {
    return fetchJson<SessionEvent[]>(`/sessions/${sessionId}/events`);
  },

  async validateInvite(inviteToken: string): Promise<ValidateInviteResponse> {
    return fetchJson<ValidateInviteResponse>('/sessions/validate-invite', {
      method: 'POST',
      body: JSON.stringify({ invite_token: inviteToken }),
    });
  },

  /**
   * Participants
   */
  async joinSession(
    sessionId: string,
    userId: string,
    role: 'agent' | 'customer',
    inviteToken?: string
  ): Promise<Participant> {
    return fetchJson<Participant>(`/sessions/${sessionId}/participants/join`, {
      method: 'POST',
      body: JSON.stringify({ invite_token: inviteToken }),
      headers: {
        'X-User-ID': userId,
        'X-User-Role': role,
      },
    });
  },

  async leaveSession(
    sessionId: string,
    participantId: string
  ): Promise<Participant> {
    return fetchJson<Participant>(
      `/sessions/${sessionId}/participants/${participantId}/leave`,
      { method: 'POST' }
    );
  },

  async disconnectParticipant(
    sessionId: string,
    participantId: string
  ): Promise<Participant> {
    return fetchJson<Participant>(
      `/sessions/${sessionId}/participants/${participantId}/disconnect`,
      { method: 'POST' }
    );
  },

  async reconnectParticipant(
    sessionId: string,
    participantId: string
  ): Promise<Participant> {
    return fetchJson<Participant>(
      `/sessions/${sessionId}/participants/${participantId}/reconnect`,
      { method: 'POST' }
    );
  },

  async getSessionParticipants(sessionId: string): Promise<Participant[]> {
    return fetchJson<Participant[]>(`/sessions/${sessionId}/participants`);
  },

  async getChatMessages(sessionId: string): Promise<ChatMessage[]> {
    return fetchJson<ChatMessage[]>(`/sessions/${sessionId}/messages`);
  },
};

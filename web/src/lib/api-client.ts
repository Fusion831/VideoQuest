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

let customToken: string | null = null;

async function fetchJson<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  let resolvedBase = API_BASE_URL;
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      resolvedBase = API_BASE_URL.replace(/localhost|127\.0\.0\.1/g, hostname);
    }
  }
  const url = `${resolvedBase}${endpoint}`;
  
  // Set JSON headers by default
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Auto-attach stored Bearer token if available in browser
  if (typeof window !== 'undefined') {
    let token = customToken;

    if (!token) {
      // Fallback: Resolve session-specific token if url matches a session path, otherwise global auth token
      const sessionMatch = url.match(/\/sessions\/([a-f0-9-]+)/i);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        token = localStorage.getItem(`vq_session_token_${sessionId}`);
      }
      if (!token) {
        token = localStorage.getItem('vq_auth_token');
      }
    }
    
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
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
  setToken(token: string | null) {
    customToken = token;
  },
  /**
   * Authentication
   */
  async login(username: string, password: string): Promise<{ status: string; token: string; user_id: string; role: string }> {
    const res = await fetchJson<{ status: string; token: string; user_id: string; role: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (typeof window !== 'undefined' && res.status === 'success') {
      localStorage.setItem('vq_auth_userId', res.user_id);
      localStorage.setItem('vq_auth_role', res.role.toLowerCase());
      localStorage.setItem('vq_auth_token', res.token);
    }
    return res;
  },

  async getMe(): Promise<{ user_id: string; role: string }> {
    return fetchJson<{ user_id: string; role: string }>('/auth/me');
  },

  /**
   * Sessions
   */
  async createSession(agentId: string): Promise<Session> {
    return fetchJson<Session>('/sessions/', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId }),
    });
  },

  async createSupportRequest(
    customerName: string,
    issueDescription: string
  ): Promise<{ session: Session; participant: Participant; token: string }> {
    const res = await fetchJson<{ session: Session; participant: Participant; token: string }>('/sessions/request', {
      method: 'POST',
      body: JSON.stringify({ customer_name: customerName, issue_description: issueDescription }),
    });
    if (typeof window !== 'undefined' && res.token) {
      localStorage.setItem(`vq_session_token_${res.session.id}`, res.token);
      localStorage.setItem(`vq_identity_${res.session.id}_userId`, res.participant.user_id);
      localStorage.setItem(`vq_identity_${res.session.id}_role`, res.participant.role.toLowerCase());
    }
    return res;
  },

  async acceptSession(sessionId: string): Promise<Session> {
    return fetchJson<Session>(`/sessions/${sessionId}/accept`, {
      method: 'POST',
    });
  },

  async requestVideo(sessionId: string): Promise<Session> {
    return fetchJson<Session>(`/sessions/${sessionId}/request-video`, {
      method: 'POST',
    });
  },

  async acceptVideo(sessionId: string): Promise<Session> {
    return fetchJson<Session>(`/sessions/${sessionId}/accept-video`, {
      method: 'POST',
    });
  },

  async getSessions(status?: string, unassigned?: boolean): Promise<SessionListResponse> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (unassigned !== undefined) params.append('unassigned', unassigned.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchJson<SessionListResponse>(`/sessions/${query}`);
  },

  async getSession(sessionId: string): Promise<Session> {
    return fetchJson<Session>(`/sessions/${sessionId}`);
  },

  async endSession(sessionId: string, agentId: string): Promise<Session> {
    return fetchJson<Session>(`/sessions/${sessionId}/end`, {
      method: 'POST',
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
    displayName: string,
    role: 'agent' | 'customer',
    inviteToken?: string
  ): Promise<Participant & { token?: string }> {
    const body = role === 'agent'
      ? { invite_token: inviteToken }
      : { invite_token: inviteToken, display_name: displayName };

    const res = await fetchJson<Participant & { token?: string }>(`/sessions/${sessionId}/participants/join`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (typeof window !== 'undefined') {
      if (res.token) {
        localStorage.setItem(`vq_session_token_${sessionId}`, res.token);
      }
      localStorage.setItem(`vq_identity_${sessionId}_userId`, res.user_id);
      localStorage.setItem(`vq_identity_${sessionId}_role`, res.role.toLowerCase());
    }
    return res;
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

  async getLiveKitToken(
    sessionId: string,
    userId: string,
    role: 'agent' | 'customer'
  ): Promise<{ token: string; livekit_url: string }> {
    return fetchJson<{ token: string; livekit_url: string }>(
      `/sessions/${sessionId}/livekit-token`,
      {
        method: 'GET',
      }
    );
  },
};

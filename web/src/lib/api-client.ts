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

  // Auto-attach stored credentials if available in browser
  if (typeof window !== 'undefined') {
    // 1. Resolve session-specific identity if url matches a session path
    const sessionMatch = url.match(/\/sessions\/([a-f0-9-]+)/i);
    let resolvedUserId: string | null = null;
    let resolvedRole: string | null = null;
    
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      resolvedUserId = localStorage.getItem(`vq_identity_${sessionId}_userId`);
      resolvedRole = localStorage.getItem(`vq_identity_${sessionId}_role`);
    }
    
    // 2. Fall back to global authenticated agent identity
    if (!resolvedUserId || !resolvedRole) {
      resolvedUserId = localStorage.getItem('vq_auth_userId');
      resolvedRole = localStorage.getItem('vq_auth_role');
    }
    
    if (resolvedUserId && !headers.has('X-User-ID')) {
      headers.set('X-User-ID', resolvedUserId);
    }
    if (resolvedRole && !headers.has('X-User-Role')) {
      headers.set('X-User-Role', resolvedRole.toUpperCase());
    }
    
    const savedToken = localStorage.getItem('vq_auth_token');
    if (savedToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${savedToken}`);
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

  /**
   * Sessions
   */
  async createSession(agentId: string): Promise<Session> {
    return fetchJson<Session>('/sessions/', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId }),
    });
  },

  async getSessions(status?: string): Promise<SessionListResponse> {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return fetchJson<SessionListResponse>(`/sessions/${query}`);
  },

  async getSession(sessionId: string): Promise<Session> {
    return fetchJson<Session>(`/sessions/${sessionId}`);
  },

  async endSession(
    sessionId: string,
    agentId: string,
    resolutionStatus?: string,
    resolutionNotes?: string
  ): Promise<Session> {
    return fetchJson<Session>(`/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: {
        'X-User-ID': agentId,
        'X-User-Role': 'agent',
      },
      body: JSON.stringify({
        resolution_status: resolutionStatus,
        resolution_notes: resolutionNotes,
      }),
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

  async getLiveKitToken(
    sessionId: string,
    userId: string,
    role: 'agent' | 'customer'
  ): Promise<{ token: string; livekit_url: string }> {
    return fetchJson<{ token: string; livekit_url: string }>(
      `/sessions/${sessionId}/livekit-token`,
      {
        method: 'GET',
        headers: {
          'X-User-ID': userId,
          'X-User-Role': role,
        },
      }
    );
  },
};

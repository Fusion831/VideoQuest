export interface Session {
  id: string;
  invite_token: string;
  status: 'CREATED' | 'ACTIVE' | 'ABANDONED' | 'ENDED';
  agent_id: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
}

export interface SessionEvent {
  id: string;
  session_id: string;
  event_type: string;
  timestamp: string;
  metadata: Record<string, any>;
}

export interface Participant {
  id: string;
  session_id: string;
  role: 'AGENT' | 'CUSTOMER';
  user_id: string;
  joined_at: string;
  left_at: string | null;
  connection_status: 'CONNECTED' | 'DISCONNECTED' | 'LEFT';
  created_at: string;
  updated_at: string;
}

export interface ValidateInviteResponse {
  valid: boolean;
  session_id: string;
  status: 'CREATED' | 'ACTIVE' | 'ABANDONED' | 'ENDED';
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  sender_participant_id: string | null;
  message_type: 'USER' | 'SYSTEM';
  content: string;
  metadata: Record<string, any>;
  created_at: string;
}

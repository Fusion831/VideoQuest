"use client";

import { use, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Session, Participant, SessionEvent, ChatMessage } from '@/lib/types';
import ChatPanel from '@/components/ChatPanel';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default function SessionRoomPage({ params }: PageProps) {
  const { sessionId } = use(params);
  const searchParams = useSearchParams();

  // URL Query context (to simulate being a specific joined participant)
  const currentRole = searchParams.get('role') as 'agent' | 'customer' | null;
  const currentUserId = searchParams.get('userId');

  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // Simulation controls state
  const [simUserId, setSimUserId] = useState(currentUserId || 'user_sim');
  const [simRole, setSimRole] = useState<'agent' | 'customer'>(currentRole || 'agent');
  const [simInviteToken, setSimInviteToken] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);

  // Fetch all room data
  const refreshRoomData = async () => {
    if (!sessionId) return;
    try {
      const [sessionRes, participantsRes, eventsRes, chatMessagesRes] = await Promise.all([
        apiClient.getSession(sessionId),
        apiClient.getSessionParticipants(sessionId),
        apiClient.getSessionEvents(sessionId),
        apiClient.getChatMessages(sessionId),
      ]);
      setSession(sessionRes);
      setParticipants(participantsRes);
      setEvents(eventsRes.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
      setChatMessages(chatMessagesRes);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to sync room state');
    } finally {
      setLoading(false);
    }
  };

  // UX1 fix: resolve identity from URL params first, fall back to localStorage
  const storedIdentityKey = `vq_identity_${sessionId}`;
  const [resolvedUserId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return currentUserId;
    return currentUserId || localStorage.getItem(`${storedIdentityKey}_userId`);
  });
  const [resolvedRole] = useState<'agent' | 'customer' | null>(() => {
    if (typeof window === 'undefined') return currentRole;
    const stored = localStorage.getItem(`${storedIdentityKey}_role`) as 'agent' | 'customer' | null;
    return currentRole || stored;
  });

  // Find current participant ID from the loaded participants list
  const currentParticipant = participants.find(
    (p) => p.user_id === resolvedUserId && p.role.toLowerCase() === resolvedRole?.toLowerCase()
  );
  const currentParticipantId = currentParticipant?.id || null;

  // Persist participant identity to localStorage whenever we successfully identify ourselves
  useEffect(() => {
    if (resolvedUserId && resolvedRole && typeof window !== 'undefined') {
      localStorage.setItem(`${storedIdentityKey}_userId`, resolvedUserId);
      localStorage.setItem(`${storedIdentityKey}_role`, resolvedRole);
    }
  }, [resolvedUserId, resolvedRole, storedIdentityKey]);

  // Fetch room data on mount or sessionId change
  useEffect(() => {
    refreshRoomData();
  }, [sessionId]);

  // UX2 fix: WS effect only depends on sessionId to avoid reconnect loops.
  // currentParticipantId is passed via URL param at connect time (captured at open).
  // Re-runs only when we navigate to a different session.

  // Establish WebSocket connection for real-time updates (tied to sessionId only)
  useEffect(() => {
    if (!sessionId) return;

    // Capture participant ID at the moment the WS connection is opened
    // so that identity changes mid-render don't cause reconnect loops (UX2 fix)
    const participantIdAtOpen = currentParticipantId;

    let wsHost = 'ws://localhost:8000';
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    if (apiUrl) {
      try {
        const urlObj = new URL(apiUrl);
        const wsProto = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
        wsHost = `${wsProto}//${urlObj.host}`;
      } catch (e) {
        if (typeof window !== 'undefined') {
          const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsHost = `${wsProto}//${window.location.host}`;
        }
      }
    }

    let wsUrl = `${wsHost}/api/v1/sessions/${sessionId}/ws`;
    if (participantIdAtOpen) {
      wsUrl += `?participant_id=${participantIdAtOpen}`;
    }

    console.log(`Connecting to WebSocket: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connection established.');
      setError(null);
      refreshRoomData();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Received WebSocket event:', data);
        if (data.event_type === 'MESSAGE_RECEIVED') {
          setChatMessages((prev) => {
            if (prev.some((m) => m.id === data.payload.id)) return prev;
            return [...prev, data.payload];
          });
        } else if (data.event_type === 'MESSAGE_SEND_ERROR') {
          setError(`Failed to send message: ${data.payload.reason}`);
        } else {
          // For participant updates or session state changes, sync room details
          refreshRoomData();
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = (e) => {
      console.log(`WebSocket connection closed: ${e.reason} (code: ${e.code})`);
      if (e.code === 4000) {
        setError('Session has ended or is invalid');
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, currentParticipantId]); // Connect as participant once currentParticipantId loads

  // Set default invite token from fetched session
  useEffect(() => {
    if (session) {
      setSimInviteToken(session.invite_token);
    }
  }, [session]);

  // Copy customer join link to clipboard
  const handleCopyLink = () => {
    if (!session) return;
    const link = `${window.location.origin}/join/${session.invite_token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  // Actions
  const handleJoinSimulation = async () => {
    try {
      setError(null);
      await apiClient.joinSession(sessionId, simUserId, simRole, simRole === 'customer' ? simInviteToken : undefined);
      await refreshRoomData();
    } catch (err: any) {
      setError(err.message || 'Join failed');
    }
  };

  const handleDisconnect = async (pId: string) => {
    try {
      setError(null);
      await apiClient.disconnectParticipant(sessionId, pId);
      await refreshRoomData();
    } catch (err: any) {
      setError(err.message || 'Disconnect failed');
    }
  };

  const handleReconnect = async (pId: string) => {
    try {
      setError(null);
      await apiClient.reconnectParticipant(sessionId, pId);
      await refreshRoomData();
    } catch (err: any) {
      setError(err.message || 'Reconnect failed');
    }
  };

  const handleLeave = async (pId: string) => {
    try {
      setError(null);
      await apiClient.leaveSession(sessionId, pId);
      await refreshRoomData();
    } catch (err: any) {
      setError(err.message || 'Leave failed');
    }
  };

  const handleEndSession = async () => {
    if (!session || !confirm('Are you sure you want to terminate this support session?')) return;
    try {
      setError(null);
      await apiClient.endSession(sessionId, session.agent_id);
      await refreshRoomData();
    } catch (err: any) {
      setError(err.message || 'Failed to end session');
    }
  };

  const handleSendMessage = (content: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: 'SEND_MESSAGE',
          data: { content },
        })
      );
    } else {
      setError('Cannot send message: Real-time connection is offline');
    }
  };

  if (loading && !session) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-400 flex flex-col items-center justify-center gap-3">
        <svg className="w-8 h-8 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span>Synchronizing with session gateway...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/agent"
              className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <span className="text-zinc-500">/</span>
            <span className="font-semibold text-sm text-zinc-200">Session Diagnostic Room</span>
          </div>

          <div className="flex items-center gap-3">
            {session && (
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                session.status === 'ACTIVE' 
                  ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/40' 
                  : session.status === 'ABANDONED'
                  ? 'bg-amber-950/50 text-amber-400 border border-amber-800/40'
                  : session.status === 'ENDED'
                  ? 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                  : 'bg-indigo-950/50 text-indigo-400 border border-indigo-800/40'
              }`}>
                {session.status === 'ABANDONED' ? '⚠ ABANDONED' : session.status}
              </span>
            )}
            <button
              onClick={refreshRoomData}
              className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-all"
            >
              Force Sync
            </button>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-950/50 border border-red-800/50 text-red-200 text-sm flex gap-3 items-center">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>{error}</div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Side: Room Details & Participant List (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Room Metadata */}
            {session && (
              <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-xl shadow-black/30">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4">
                  Session Metadata
                </h3>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-1 border-b border-zinc-800/40">
                    <span className="text-zinc-500">Session ID</span>
                    <span className="font-mono text-zinc-300">{session.id}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/40">
                    <span className="text-zinc-500">Assigned Agent</span>
                    <span className="text-zinc-300">{session.agent_id}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/40">
                    <span className="text-zinc-500">Invite Token</span>
                    <span className="font-mono text-zinc-400">{session.invite_token}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-500">Created At</span>
                    <span className="text-zinc-400">{new Date(session.created_at).toLocaleString()}</span>
                  </div>
                </div>

                {session.status !== 'ENDED' && (
                  <div className="mt-6 flex gap-2">
                    <button
                      onClick={handleCopyLink}
                      className="flex-1 py-2 px-3 rounded-lg bg-indigo-950/60 hover:bg-indigo-900/40 text-indigo-400 border border-indigo-800/40 text-xs font-semibold flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      {copySuccess ? 'Copied Link!' : 'Copy Customer Invite'}
                    </button>
                    <button
                      onClick={handleEndSession}
                      className="py-2 px-4 rounded-lg bg-red-950/40 hover:bg-red-900/30 text-red-400 border border-red-900/30 text-xs font-semibold transition-all active:scale-95"
                    >
                      End Session
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Participants list */}
            <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-xl shadow-black/30">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4">
                Registered Participants
              </h3>
              
              {participants.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-xl bg-zinc-950/25">
                  No participants registered in this session yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {participants.map((p) => (
                    <div
                      key={p.id}
                      className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col gap-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-sm text-zinc-200">{p.user_id}</div>
                          <div className="text-[10px] text-zinc-500 font-medium tracking-wider uppercase mt-0.5">
                            {p.role}
                          </div>
                        </div>

                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          p.connection_status === 'CONNECTED'
                            ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/40'
                            : p.connection_status === 'DISCONNECTED'
                            ? 'bg-amber-950/50 text-amber-400 border border-amber-800/40 animate-pulse'
                            : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                        }`}>
                          {p.connection_status}
                        </span>
                      </div>

                      {/* Participant state controls */}
                      {session?.status !== 'ENDED' && (
                        <div className="flex gap-1.5 border-t border-zinc-900 pt-2.5">
                          {p.connection_status === 'CONNECTED' && (
                            <>
                              <button
                                onClick={() => handleDisconnect(p.id)}
                                className="flex-1 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-[10px] font-semibold text-amber-400 transition-all"
                              >
                                Disconnect
                              </button>
                              <button
                                onClick={() => handleLeave(p.id)}
                                className="flex-1 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-[10px] font-semibold text-red-400 transition-all"
                              >
                                Leave
                              </button>
                            </>
                          )}
                          {p.connection_status === 'DISCONNECTED' && (
                            <>
                              <button
                                onClick={() => handleReconnect(p.id)}
                                className="flex-1 py-1 rounded bg-indigo-950 hover:bg-indigo-900/30 text-[10px] font-semibold text-indigo-400 border border-indigo-800/30 transition-all"
                              >
                                Reconnect
                              </button>
                              <button
                                onClick={() => handleLeave(p.id)}
                                className="flex-1 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-[10px] font-semibold text-red-400 transition-all"
                              >
                                Leave
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Middle/Right Side: diagnostic events & simulations controller (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Participant Simulation Controller */}
            {session?.status !== 'ENDED' && (
              <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-xl shadow-black/30">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4">
                  Join Simulator Controller
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                      User ID
                    </label>
                    <input
                      type="text"
                      value={simUserId}
                      onChange={(e) => setSimUserId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                      Simulated Role
                    </label>
                    <select
                      value={simRole}
                      onChange={(e) => setSimRole(e.target.value as 'agent' | 'customer')}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 outline-none focus:border-indigo-500"
                    >
                      <option value="agent">AGENT</option>
                      <option value="customer">CUSTOMER</option>
                    </select>
                  </div>
                </div>

                {simRole === 'customer' && (
                  <div className="mt-4">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                      Customer Invite Token
                    </label>
                    <input
                      type="text"
                      value={simInviteToken}
                      onChange={(e) => setSimInviteToken(e.target.value)}
                      placeholder="Required for customer joins"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 outline-none focus:border-indigo-500"
                    />
                  </div>
                )}

                <button
                  onClick={handleJoinSimulation}
                  className="w-full mt-5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:bg-zinc-850 text-zinc-200 text-xs font-semibold shadow-md active:scale-95 transition-all"
                >
                  Join via Simulator
                </button>
              </div>
            )}

            {/* Chat Room */}
            <ChatPanel
              messages={chatMessages}
              participants={participants}
              currentParticipantId={currentParticipantId}
              sessionStatus={session?.status || 'CREATED'}
              onSendMessage={handleSendMessage}
            />

            {/* Diagnostic Event Logs */}
            <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-xl shadow-black/30">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4 flex items-center justify-between">
                <span>Diagnostic Event Log Feed</span>
                <span className="text-[10px] bg-zinc-950 px-2 py-0.5 rounded text-zinc-500 font-mono">
                  {events.length} events
                </span>
              </h3>

              <div className="rounded-xl bg-zinc-950 border border-zinc-900 p-4 max-h-[360px] overflow-y-auto font-mono text-[11px] leading-relaxed space-y-3 scrollbar-thin">
                {events.length === 0 ? (
                  <div className="text-center text-zinc-700 py-6">
                    Waiting for state telemetry signals...
                  </div>
                ) : (
                  events.map((event) => (
                    <div key={event.id} className="pb-2.5 border-b border-zinc-900/40 last:border-0 last:pb-0">
                      <div className="flex justify-between items-center text-zinc-500">
                        <span className="text-indigo-400 font-semibold">{event.event_type}</span>
                        <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="mt-1 text-zinc-400">
                        {event.metadata && Object.keys(event.metadata).length > 0 ? (
                          <pre className="p-2 rounded bg-zinc-900/40 text-zinc-400 overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(event.metadata)}
                          </pre>
                        ) : (
                          <span className="italic text-zinc-600">No metadata payload</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

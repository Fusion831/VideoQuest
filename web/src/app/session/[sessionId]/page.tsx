"use client";

import { use, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Session, Participant, SessionEvent, ChatMessage } from '@/lib/types';
import ChatPanel from '@/components/ChatPanel';
import MediaRoom from '@/components/MediaRoom';

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
  const [copySuccess, setCopySuccess] = useState(false);
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const storedIdentityKey = `vq_identity_${sessionId}`;

  // Resolve identity: session-specific storage first, then global agent auth, then URL query params
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return currentUserId;
    const sessionUserId = localStorage.getItem(`${storedIdentityKey}_userId`);
    if (sessionUserId) return sessionUserId;
    const globalUserId = localStorage.getItem('vq_auth_userId');
    const globalRole = localStorage.getItem('vq_auth_role');
    if (globalRole === 'agent' && globalUserId) return globalUserId;
    return currentUserId;
  });

  const [resolvedRole, setResolvedRole] = useState<'agent' | 'customer' | null>(() => {
    if (typeof window === 'undefined') return currentRole;
    const sessionRole = localStorage.getItem(`${storedIdentityKey}_role`) as 'agent' | 'customer' | null;
    if (sessionRole) return sessionRole;
    const globalRole = localStorage.getItem('vq_auth_role') as 'agent' | 'customer' | null;
    if (globalRole === 'agent') return 'agent';
    return currentRole;
  });

  // Keep state and localStorage in sync & log identity resolution path
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const globalUserId = localStorage.getItem('vq_auth_userId');
    const globalRole = localStorage.getItem('vq_auth_role') as 'agent' | 'customer' | null;
    const globalToken = localStorage.getItem('vq_auth_token');

    const sessionUserId = localStorage.getItem(`${storedIdentityKey}_userId`);
    const sessionRole = localStorage.getItem(`${storedIdentityKey}_role`) as 'agent' | 'customer' | null;

    let finalUserId = resolvedUserId;
    let finalRole = resolvedRole;
    let source = 'state defaults';

    if (sessionUserId && sessionRole) {
      finalUserId = sessionUserId;
      finalRole = sessionRole;
      source = 'session-specific localstorage';
    } else if (globalRole === 'agent' && globalUserId) {
      finalUserId = globalUserId;
      finalRole = 'agent';
      source = 'global agent authentication';
    } else if (currentUserId && currentRole) {
      finalUserId = currentUserId;
      finalRole = currentRole;
      source = 'URL query parameters';
    }

    console.log('[IdentityResolution] Path Audit:', {
      inputs: {
        global: { user_id: globalUserId, role: globalRole, hasToken: !!globalToken },
        session: { user_id: sessionUserId, role: sessionRole },
        query: { user_id: currentUserId, role: currentRole }
      },
      resolved: { user_id: finalUserId, role: finalRole },
      resolvedFrom: source
    });

    if (finalUserId !== resolvedUserId) setResolvedUserId(finalUserId);
    if (finalRole !== resolvedRole) setResolvedRole(finalRole);

    // Save identity to session storage (never downgrade agent to customer)
    if (finalUserId && finalRole) {
      localStorage.setItem(`${storedIdentityKey}_userId`, finalUserId);
      localStorage.setItem(`${storedIdentityKey}_role`, finalRole);
    }
  }, [resolvedUserId, resolvedRole, storedIdentityKey, currentUserId, currentRole]);

  // Find current participant ID from the loaded participants list
  const currentParticipant = participants.find(
    (p) => p.user_id === resolvedUserId && p.role.toLowerCase() === resolvedRole?.toLowerCase()
  );
  const currentParticipantId = currentParticipant?.id || null;

  // Fetch all room data
  const refreshRoomData = async () => {
    if (!sessionId) return;
    try {
      const isAgent = resolvedRole === 'agent';
      const [sessionRes, participantsRes, eventsRes, chatMessagesRes] = await Promise.all([
        apiClient.getSession(sessionId),
        apiClient.getSessionParticipants(sessionId),
        isAgent ? apiClient.getSessionEvents(sessionId) : Promise.resolve([]),
        apiClient.getChatMessages(sessionId),
      ]);
      setSession(sessionRes);
      setParticipants(participantsRes);
      setEvents(eventsRes.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
      setChatMessages(chatMessagesRes);
      setError(null);
    } catch (err: any) {
      console.error('[refreshRoomData] Failed:', err);
      setError(err.message || 'Failed to sync room state');
    } finally {
      setLoading(false);
    }
  };

  // Fetch room data on mount, sessionId or resolvedRole change
  useEffect(() => {
    refreshRoomData();
  }, [sessionId, resolvedRole]);

  // Self-healing Auto-join flow: Join automatically if resolved identity is present but not in the roster
  useEffect(() => {
    if (loading || !session || session.status === 'ENDED' || autoJoinAttempted) return;
    if (!resolvedUserId || !resolvedRole) return;

    const exists = participants.some(
      (p) => p.user_id === resolvedUserId && p.role.toLowerCase() === resolvedRole.toLowerCase()
    );

    if (!exists) {
      console.log(`[AutoJoin] Participant ${resolvedUserId} (${resolvedRole}) not found in roster. Joining...`);
      setAutoJoinAttempted(true);
      (window as any).__join_clicked = performance.now();
      apiClient.joinSession(
        sessionId,
        resolvedUserId,
        resolvedRole,
        resolvedRole === 'customer' ? session.invite_token : undefined
      )
      .then(() => {
        console.log('[AutoJoin] Join success. Refreshing room data...');
        refreshRoomData();
      })
      .catch((err) => {
        console.error('[AutoJoin] Join failed:', err);
        setError(err.message || 'Auto-join failed');
      });
    }
  }, [loading, session, participants, resolvedUserId, resolvedRole, sessionId, autoJoinAttempted]);

  // Establish real-time WebSocket connection
  useEffect(() => {
    if (!sessionId) return;

    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    let resolvedApiBase = apiBase;
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        resolvedApiBase = apiBase.replace(/localhost|127\.0\.0\.1/g, hostname);
      }
    }

    let wsHost = 'ws://localhost:8000';
    try {
      const urlObj = new URL(resolvedApiBase);
      const wsProto = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
      wsHost = `${wsProto}//${urlObj.host}`;
    } catch (e) {
      if (typeof window !== 'undefined') {
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsHost = `${wsProto}//${window.location.host}`;
      }
    }

    let wsUrl = `${wsHost}/api/v1/sessions/${sessionId}/ws`;
    if (currentParticipantId) {
      wsUrl += `?participant_id=${currentParticipantId}`;
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
        console.log('[WebSocket onmessage] Received event:', data);

        const eventType = data.event_type;

        if (eventType === 'MESSAGE_RECEIVED') {
          setChatMessages((prev) => {
            if (prev.some((m) => m.id === data.payload.id)) return prev;
            return [...prev, data.payload];
          });
          // System messages indicate state changes — refresh roster and session
          if (data.payload.message_type === 'SYSTEM') {
            console.log('[WebSocket] SYSTEM message received. Refreshing room data.');
            refreshRoomData();
          }
        } else if (eventType === 'MESSAGE_SEND_ERROR') {
          setError(`Failed to send message: ${data.payload.reason}`);
        } else if (
          eventType === 'PARTICIPANT_JOINED' ||
          eventType === 'PARTICIPANT_LEFT' ||
          eventType === 'PARTICIPANT_DISCONNECTED' ||
          eventType === 'PARTICIPANT_RECONNECTED'
        ) {
          // Participant lifecycle events — immediately refresh roster
          console.log(`[WebSocket] ${eventType} event received for ${data.payload?.user_id}. Refreshing roster.`);
          refreshRoomData();
        } else {
          // Unknown/other events — still refresh as safety net
          console.log(`[WebSocket] Unhandled event type: ${eventType}. Refreshing room data.`);
          refreshRoomData();
        }
      } catch (err) {
        console.error('[WebSocket onmessage] Error handling WebSocket message:', err);
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
  }, [sessionId, currentParticipantId]);

  // Copy customer join link to clipboard
  const handleCopyLink = () => {
    if (!session) return;
    const link = `${window.location.origin}/join/${session.invite_token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
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

      // If we left as ourselves, clear our local resolved identity
      if (pId === currentParticipantId) {
        setResolvedUserId(null);
        setResolvedRole(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem(`${storedIdentityKey}_userId`);
          localStorage.removeItem(`${storedIdentityKey}_role`);
        }
      }

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

  const isAgent = resolvedRole === 'agent';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <header className="border-b border-zinc-850 bg-zinc-900/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isAgent && (
              <Link
                href="/agent"
                className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
            )}
            {!isAgent && (
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-white shadow-lg">
                VQ
              </div>
            )}
            <span className="font-semibold text-sm text-zinc-200">
              {isAgent ? 'Support Session' : 'Support Session'}
            </span>
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
            {isAgent && (
              <button
                onClick={refreshRoomData}
                className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-all"
              >
                Sync Status
              </button>
            )}
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

        {isAgent ? (
          /* AGENT VIEW: Two columns layout with event log at the bottom */
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column (8 cols): Media Room + Participants Roster */}
              <div className="lg:col-span-8 space-y-6">
                {resolvedUserId && resolvedRole ? (
                  <MediaRoom
                    sessionId={sessionId}
                    userId={resolvedUserId}
                    role={resolvedRole}
                    sessionStatus={session?.status || 'CREATED'}
                  />
                ) : (
                  <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 text-center text-zinc-500 text-xs">
                    Initializing local identity...
                  </div>
                )}

                {/* Participant Roster */}
                <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-xl shadow-black/30">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4">
                    Active Roster
                  </h3>
                  
                  {participants.length === 0 ? (
                    <div className="py-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-xl bg-zinc-950/25">
                      No participants registered yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {participants.map((p) => (
                        <div
                          key={p.id}
                          className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col justify-between gap-3"
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

                          {session?.status !== 'ENDED' && (
                            <div className="flex gap-1.5 border-t border-zinc-900 pt-2.5">
                              {p.connection_status === 'CONNECTED' && (
                                <>
                                  <button
                                    onClick={() => handleDisconnect(p.id)}
                                    className="flex-1 py-1 rounded bg-zinc-900 hover:bg-zinc-850 text-[10px] font-semibold text-amber-400 transition-all active:scale-95"
                                  >
                                    Disconnect
                                  </button>
                                  <button
                                    onClick={() => handleLeave(p.id)}
                                    className="flex-1 py-1 rounded bg-zinc-900 hover:bg-zinc-850 text-[10px] font-semibold text-red-400 transition-all active:scale-95"
                                  >
                                    Leave
                                  </button>
                                </>
                              )}
                              {p.connection_status === 'DISCONNECTED' && (
                                <>
                                  <button
                                    onClick={() => handleReconnect(p.id)}
                                    className="flex-1 py-1 rounded bg-indigo-950 hover:bg-indigo-900/30 text-[10px] font-semibold text-indigo-400 border border-indigo-800/30 transition-all active:scale-95"
                                  >
                                    Reconnect
                                  </button>
                                  <button
                                    onClick={() => handleLeave(p.id)}
                                    className="flex-1 py-1 rounded bg-zinc-900 hover:bg-zinc-850 text-[10px] font-semibold text-red-400 transition-all active:scale-95"
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

              {/* Right Column (4 cols): Chat + Session Details */}
              <div className="lg:col-span-4 space-y-6">
                <ChatPanel
                  messages={chatMessages}
                  participants={participants}
                  currentParticipantId={currentParticipantId}
                  sessionStatus={session?.status || 'CREATED'}
                  onSendMessage={handleSendMessage}
                />

                {/* Session Metadata */}
                {session && (
                  <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-xl shadow-black/30">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4">
                      Session Details
                    </h3>
                    <div className="space-y-3 text-xs">
                      <div className="flex justify-between py-1 border-b border-zinc-800/40">
                        <span className="text-zinc-500">Session ID</span>
                        <span className="font-mono text-zinc-350">{session.id}</span>
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
                          {copySuccess ? 'Copied Link!' : 'Invite Customer'}
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
              </div>
            </div>

            {/* Collapsible Session Event Log (Agent-Only) */}
            <details className="group border border-zinc-850 rounded-2xl bg-zinc-900 shadow-xl shadow-black/45 overflow-hidden">
              <summary className="p-6 cursor-pointer select-none flex items-center justify-between font-semibold text-sm uppercase tracking-wider text-zinc-400 hover:bg-zinc-800/40 transition-all">
                <span className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-zinc-500 group-open:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                  Session Event Log
                </span>
                <span className="text-[10px] bg-zinc-950 px-2 py-0.5 rounded text-zinc-500 font-mono">
                  {events.length} events
                </span>
              </summary>
              <div className="px-6 pb-6 pt-2">
                <div className="rounded-xl bg-zinc-950 border border-zinc-850 p-4 max-h-[300px] overflow-y-auto font-mono text-[11px] leading-relaxed space-y-3 scrollbar-thin">
                  {events.length === 0 ? (
                    <div className="text-center text-zinc-700 py-6">
                      No session events recorded yet.
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
                            <span className="italic text-zinc-650">No metadata payload</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </details>
          </div>
        ) : (
          /* CUSTOMER VIEW: Media Room + Participants Roster (Left), Chat (Right) - No admin controls */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column (8 cols): Media Room + Participants Roster */}
            <div className="lg:col-span-8 space-y-6">
              {resolvedUserId && resolvedRole ? (
                <MediaRoom
                  sessionId={sessionId}
                  userId={resolvedUserId}
                  role={resolvedRole}
                  sessionStatus={session?.status || 'CREATED'}
                />
              ) : (
                <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 text-center text-zinc-500 text-xs">
                  Initializing secure video stream...
                </div>
              )}

              {/* Participant Roster */}
              <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-xl shadow-black/30">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-4">
                  Active Roster
                </h3>
                
                {participants.length === 0 ? (
                  <div className="py-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-xl bg-zinc-950/25">
                    No participants registered yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {participants.map((p) => (
                      <div
                        key={p.id}
                        className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col justify-between gap-3"
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
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column (4 cols): Chat Panel */}
            <div className="lg:col-span-4">
              <ChatPanel
                messages={chatMessages}
                participants={participants}
                currentParticipantId={currentParticipantId}
                sessionStatus={session?.status || 'CREATED'}
                onSendMessage={handleSendMessage}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

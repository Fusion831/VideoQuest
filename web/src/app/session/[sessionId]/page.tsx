"use client";

import { use, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Session, Participant, SessionEvent, ChatMessage } from '@/lib/types';
import ChatPanel from '@/components/ChatPanel';
import MediaRoom from '@/components/MediaRoom';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default function SessionRoomPage({ params }: PageProps) {
  const { sessionId } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [identityResolved, setIdentityResolved] = useState(false);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [resolvedRole, setResolvedRole] = useState<'agent' | 'customer' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);
  const [customerDismissedVideoPrompt, setCustomerDismissedVideoPrompt] = useState(false);
  const [isChatSidebarCollapsed, setIsChatSidebarCollapsed] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const storedIdentityKey = `vq_identity_${sessionId}`;

  // Authenticate identity on mount via /auth/me or stored values
  useEffect(() => {
    const checkIdentity = async () => {
      try {
        const me = await apiClient.getMe();
        setResolvedUserId(me.user_id);
        setResolvedRole(me.role.toLowerCase() as 'agent' | 'customer');
        setIdentityResolved(true);
      } catch (err: any) {
        console.error('[IdentityResolution] Path Audit: Authentication verification failed:', err);
        // Fallback to localstorage values
        const localUserId = localStorage.getItem(`${storedIdentityKey}_userId`) || localStorage.getItem('vq_auth_userId');
        const localRole = localStorage.getItem(`${storedIdentityKey}_role`) || localStorage.getItem('vq_auth_role');
        if (localUserId && localRole) {
          setResolvedUserId(localUserId);
          setResolvedRole(localRole.toLowerCase() as 'agent' | 'customer');
          setIdentityResolved(true);
        } else {
          const globalRole = localStorage.getItem('vq_auth_role');
          if (globalRole === 'agent') {
            router.push('/agent/login');
          } else {
            setError('Authentication required. Please submit a support request first.');
          }
        }
      }
    };
    checkIdentity();
  }, [sessionId, router, storedIdentityKey]);

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
    if (identityResolved && sessionId) {
      refreshRoomData();
    }
  }, [sessionId, resolvedRole, identityResolved]);

  // Auto-join flow
  useEffect(() => {
    if (!identityResolved || loading || !session || session.status === 'ENDED' || autoJoinAttempted) return;
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
  }, [loading, session, participants, resolvedUserId, resolvedRole, sessionId, autoJoinAttempted, identityResolved]);

  // Establish real-time WebSocket connection
  useEffect(() => {
    if (!sessionId || !identityResolved) return;

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

    const token = localStorage.getItem(`vq_session_token_${sessionId}`) || localStorage.getItem('vq_auth_token');
    let wsUrl = `${wsHost}/api/v1/sessions/${sessionId}/ws`;
    const wsParams = [];
    if (currentParticipantId) {
      wsParams.push(`participant_id=${currentParticipantId}`);
    }
    if (token) {
      wsParams.push(`token=${encodeURIComponent(token)}`);
    }
    if (wsParams.length > 0) {
      wsUrl += `?${wsParams.join('&')}`;
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
          console.log(`[WebSocket] ${eventType} event received for ${data.payload?.user_id}. Refreshing roster.`);
          refreshRoomData();
        } else {
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
  }, [sessionId, currentParticipantId, identityResolved]);

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
      await apiClient.endSession(sessionId, session.agent_id || '');
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

  if ((loading && !session) || !identityResolved) {
    return (
      <div className="min-h-screen bg-zinc-955 text-zinc-400 flex flex-col items-center justify-center gap-3">
        <svg className="w-6 h-6 text-zinc-400 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Connecting to support session...</span>
      </div>
    );
  }

  const isAgent = resolvedRole === 'agent';
  const isVideoActive = session?.video_escalation_status === 'ACTIVE';

  return (
    <div className="min-h-screen bg-zinc-955 text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-850 bg-zinc-900/40 backdrop-blur-md h-16 flex items-center shrink-0">
        <div className="max-w-7xl mx-auto w-full px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isAgent && (
              <Link
                href="/agent"
                className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
            )}
            <span className="font-semibold text-zinc-100">
              {session?.customer_name ? `Support with ${session.customer_name}` : 'Support Room'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {session && (
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                session.status === 'ACTIVE' 
                  ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/40' 
                  : session.status === 'ENDED'
                  ? 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                  : 'bg-indigo-950/40 text-indigo-400 border border-indigo-900/40'
              }`}>
                {session.status === 'CREATED' ? 'WAITING FOR AGENT' : session.status}
              </span>
            )}
            <button
              onClick={refreshRoomData}
              className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-all"
            >
              Sync Status
            </button>
          </div>
        </div>
      </header>

      {/* Main Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-6 min-h-0 flex flex-col">
        {error && (
          <div className="mb-4 p-4 rounded-xl bg-red-950/25 border border-red-900/30 text-red-400 text-sm flex gap-3 items-center shrink-0">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>{error}</div>
          </div>
        )}

        {/* Customer Video Escalation Modal */}
        {!isAgent && session?.video_escalation_status === 'REQUESTED' && !customerDismissedVideoPrompt && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-sm w-full p-6 space-y-6 shadow-2xl">
              <div className="space-y-2 text-center">
                <div className="w-12 h-12 rounded-full bg-zinc-800 text-zinc-200 flex items-center justify-center mx-auto text-xl">
                  📹
                </div>
                <h3 className="font-semibold text-lg text-zinc-200">Start Video Call?</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  The agent would like to start a video call to assist you better.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    try {
                      setError(null);
                      await apiClient.acceptVideo(sessionId);
                      await refreshRoomData();
                    } catch (err: any) {
                      setError(err.message || 'Failed to accept video call');
                    }
                  }}
                  className="flex-1 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-medium text-xs transition-all active:scale-[0.98]"
                >
                  Join Video Call
                </button>
                <button
                  onClick={() => {
                    setCustomerDismissedVideoPrompt(true);
                  }}
                  className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-750 text-zinc-300 font-medium text-xs transition-all"
                >
                  Continue Chat
                </button>
              </div>
            </div>
          </div>
        )}

        {isVideoActive ? (
          /* ACTIVE CALL LAYOUT: 80% video / 20% chat sidebar */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
            <div className={`${isChatSidebarCollapsed ? 'lg:col-span-12' : 'lg:col-span-9'} flex flex-col min-h-0 relative`}>
              {resolvedUserId && resolvedRole ? (
                <MediaRoom
                  sessionId={sessionId}
                  userId={resolvedUserId}
                  role={resolvedRole}
                  sessionStatus={session?.status || 'CREATED'}
                />
              ) : (
                <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 text-center text-zinc-500 text-xs flex-1 flex items-center justify-center">
                  Connecting to video call...
                </div>
              )}
              
              <button
                onClick={() => setIsChatSidebarCollapsed(!isChatSidebarCollapsed)}
                className="absolute top-4 right-4 z-20 px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 text-xs font-medium backdrop-blur-sm shadow-md transition-all"
              >
                {isChatSidebarCollapsed ? '💬 Show Chat' : '✕ Hide Chat'}
              </button>
            </div>

            {!isChatSidebarCollapsed && (
              <div className="lg:col-span-3 flex flex-col min-h-0">
                <ChatPanel
                  messages={chatMessages}
                  participants={participants}
                  currentParticipantId={currentParticipantId}
                  sessionStatus={session?.status || 'CREATED'}
                  onSendMessage={handleSendMessage}
                  className="flex-1"
                />
              </div>
            )}
          </div>
        ) : (
          /* PRE-VIDEO CHAT-FIRST LAYOUT */
          <div className="max-w-2xl mx-auto w-full space-y-6 flex-1 flex flex-col justify-center">
            {session?.status === 'CREATED' && !session?.agent_id && (
              <div className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-850 text-center space-y-2">
                <div className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center mx-auto animate-pulse">
                  💬
                </div>
                <h3 className="font-semibold text-sm text-zinc-200">Waiting for agent to accept...</h3>
                <p className="text-xs text-zinc-500 leading-relaxed max-w-sm mx-auto">
                  Your support request is in queue. A support representative will claim your request shortly.
                </p>
              </div>
            )}

            {!isAgent && session?.video_escalation_status === 'REQUESTED' && customerDismissedVideoPrompt && (
              <div className="p-4 bg-indigo-950/20 border border-indigo-900/30 rounded-2xl flex items-center justify-between gap-4 text-xs shadow-lg">
                <div className="space-y-0.5">
                  <span className="text-indigo-300 font-semibold block">Video Call Requested</span>
                  <span className="text-[11px] text-zinc-400">The agent would like to start a video call.</span>
                </div>
                <button
                  onClick={async () => {
                    try {
                      setError(null);
                      await apiClient.acceptVideo(sessionId);
                      await refreshRoomData();
                    } catch (err: any) {
                      setError(err.message || 'Failed to accept video call');
                    }
                  }}
                  className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded-xl font-medium transition-all active:scale-95 shrink-0"
                >
                  Join Call
                </button>
              </div>
            )}

            <ChatPanel
              messages={chatMessages}
              participants={participants}
              currentParticipantId={currentParticipantId}
              sessionStatus={session?.status || 'CREATED'}
              onSendMessage={handleSendMessage}
              className="h-[500px] flex-none"
            />

            {/* Agent pre-video Controls */}
            {isAgent && (
              <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-850 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Agent Actions
                </h3>
                <div className="flex gap-3">
                  {session?.video_escalation_status === 'NOT_STARTED' ? (
                    <button
                      onClick={async () => {
                        try {
                          setError(null);
                          await apiClient.requestVideo(sessionId);
                          await refreshRoomData();
                        } catch (err: any) {
                          setError(err.message || 'Failed to request video call');
                        }
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-medium text-xs transition-all active:scale-[0.98]"
                    >
                      📹 Start Video Call
                    </button>
                  ) : (
                    <button
                      disabled
                      className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-zinc-500 font-medium text-xs cursor-not-allowed"
                    >
                      ⏳ Video Requested (Waiting for Customer...)
                    </button>
                  )}
                  <button
                    onClick={handleEndSession}
                    className="flex-1 py-2.5 rounded-xl bg-red-950/20 hover:bg-red-900/30 text-red-400 border border-red-900/30 font-medium text-xs transition-all active:scale-[0.98]"
                  >
                    End Support Session
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Collapsible Session Event Log (Agent-Only) */}
        {isAgent && (
          <details className="group border border-zinc-850 rounded-2xl bg-zinc-900/20 shadow-xl overflow-hidden mt-6">
            <summary className="p-4 cursor-pointer select-none flex items-center justify-between font-semibold text-xs uppercase tracking-wider text-zinc-400 hover:bg-zinc-900/40 transition-all">
              <span className="flex items-center gap-2.5">
                <svg className="w-3.5 h-3.5 text-zinc-500 group-open:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
                Developer Tools / Session Diagnostics
              </span>
              <span className="text-[10px] bg-zinc-950 px-2 py-0.5 rounded text-zinc-500 font-mono">
                {events.length} events
              </span>
            </summary>
            <div className="p-4 space-y-4">
              {/* Session details metadata */}
              {session && (
                <div className="grid grid-cols-2 gap-4 text-xs border-b border-zinc-850 pb-4">
                  <div><span className="text-zinc-500">Session ID:</span> <span className="font-mono text-zinc-300">{session.id}</span></div>
                  <div><span className="text-zinc-500">Assigned Agent:</span> <span className="text-zinc-300">{session.agent_id}</span></div>
                  <div><span className="text-zinc-500">Invite Token:</span> <span className="font-mono text-zinc-400">{session.invite_token}</span></div>
                  <div><span className="text-zinc-500">Created At:</span> <span className="text-zinc-400">{new Date(session.created_at).toLocaleString()}</span></div>
                </div>
              )}
              
              {/* Roster list */}
              <div className="space-y-2">
                <h4 className="font-semibold text-xs uppercase tracking-wider text-zinc-500">Active Roster</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {participants.map((p) => (
                    <div key={p.id} className="p-3 rounded-xl bg-zinc-950 border border-zinc-850 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-zinc-300">{p.user_id} ({p.role})</div>
                        <div className="text-[10px] text-zinc-500">{p.connection_status}</div>
                      </div>
                      {session?.status !== 'ENDED' && (
                        <div className="flex gap-1.5">
                          {p.connection_status === 'CONNECTED' && (
                            <>
                              <button onClick={() => handleDisconnect(p.id)} className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-[10px] text-amber-400 transition-all">Disconnect</button>
                              <button onClick={() => handleLeave(p.id)} className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-[10px] text-red-400 transition-all">Leave</button>
                            </>
                          )}
                          {p.connection_status === 'DISCONNECTED' && (
                            <>
                              <button onClick={() => handleReconnect(p.id)} className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-[10px] text-indigo-400 transition-all">Reconnect</button>
                              <button onClick={() => handleLeave(p.id)} className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-[10px] text-red-400 transition-all">Leave</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Event logging */}
              <div className="space-y-2">
                <h4 className="font-semibold text-xs uppercase tracking-wider text-zinc-500">Event Logs</h4>
                <div className="rounded-xl bg-zinc-950 border border-zinc-850 p-3 max-h-[200px] overflow-y-auto font-mono text-[10px] leading-relaxed space-y-2 scrollbar-thin">
                  {events.length === 0 ? (
                    <div className="text-center text-zinc-700 py-4 italic">No events recorded.</div>
                  ) : (
                    events.map((event) => (
                      <div key={event.id} className="pb-2 border-b border-zinc-900/40 last:border-0 last:pb-0">
                        <div className="flex justify-between items-center text-zinc-500">
                          <span className="text-zinc-400 font-semibold">{event.event_type}</span>
                          <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                        </div>
                        {event.metadata && Object.keys(event.metadata).length > 0 && (
                          <pre className="mt-1 p-1.5 rounded bg-zinc-900/40 text-zinc-400 overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(event.metadata)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </details>
        )}
      </main>
    </div>
  );
}

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

  const [isVideoCallOpen, setIsVideoCallOpen] = useState(true);

  // End Session Resolution Modal States
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);
  const [resolutionStatus, setResolutionStatus] = useState('RESOLVED');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [endingSession, setEndingSession] = useState(false);

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
    if (!session) return;
    try {
      setEndingSession(true);
      setError(null);
      await apiClient.endSession(sessionId, session.agent_id, resolutionStatus, resolutionNotes);
      if (typeof window !== 'undefined') {
        localStorage.setItem(`vq_consultation_${sessionId}_resolutionStatus`, resolutionStatus);
        localStorage.setItem(`vq_consultation_${sessionId}_resolutionNotes`, resolutionNotes);
      }
      setShowEndSessionModal(false);
      await refreshRoomData();
    } catch (err: any) {
      setError(err.message || 'Failed to end session');
    } finally {
      setEndingSession(false);
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
      <div className="min-h-screen bg-zinc-950 text-zinc-400 flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-800 border-t-purple-500 animate-spin" />
        <span className="text-sm font-medium text-zinc-400">Connecting with support specialists...</span>
      </div>
    );
  }

  const isAgent = resolvedRole === 'agent';
  const agentParticipant = participants.find(
    (p) => p.role.toLowerCase() === 'agent'
  );
  
  // We check if the agent is present in the roster and has connection status as CONNECTED.
  const hasAgentJoined = agentParticipant && agentParticipant.connection_status === 'CONNECTED';
  const agentName = agentParticipant ? agentParticipant.user_id : 'Support Agent';

  // 1. CUSTOMER WAITING SCREEN (No agent present in the conversation yet)
  if (!isAgent && !hasAgentJoined) {
    const issueSummary = typeof window !== 'undefined' ? localStorage.getItem(`vq_issue_${sessionId}`) : '';

    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col items-center justify-center p-4 selection:bg-purple-600 selection:text-white relative overflow-hidden">
        {/* Background ambient lighting */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-purple-900/5 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-md p-8 sm:p-10 rounded-2xl bg-zinc-900/60 border border-zinc-800/85 backdrop-blur-md shadow-2xl relative space-y-8 text-center">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-purple-500/10 to-transparent" />
          
          {/* Animated waiting icon */}
          <div className="w-16 h-16 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center mx-auto relative">
            <div className="absolute inset-0 rounded-full border-2 border-purple-500/20 animate-ping" style={{ animationDuration: '3s' }} />
            <svg className="w-8 h-8 text-purple-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
            </svg>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
              Support Request Received
            </h2>
            <p className="text-zinc-400 text-sm">
              Your request has been sent to our support team.
            </p>
          </div>

          {issueSummary && (
            <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-850 text-left space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Your Request</span>
              <p className="text-sm text-zinc-300 leading-relaxed font-normal italic">
                "{issueSummary}"
              </p>
            </div>
          )}

          <div className="border-t border-zinc-850/60 pt-6 grid grid-cols-2 gap-4">
            <div className="text-left space-y-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Status</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-ping" />
                <span className="text-xs text-zinc-350 font-medium">Waiting for agent</span>
              </div>
            </div>
            <div className="text-left space-y-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Estimated wait</span>
              <div className="text-xs text-zinc-350 font-medium mt-0.5">~2-3 minutes</div>
            </div>
          </div>

          {/* Queue position indicator */}
          <div className="pt-2 text-zinc-550 text-xs flex justify-center items-center gap-1.5 border-t border-zinc-850/40">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
            <span>Queue Position #2</span>
          </div>
        </div>
      </div>
    );
  }

  // 2. CUSTOMER / AGENT ACTIVE SESSIONS
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-purple-600 selection:text-white">
      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isAgent ? (
              <>
                <Link
                  href="/agent"
                  className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </Link>
                <div className="flex flex-col">
                  <span className="font-semibold text-sm text-zinc-200">Support Session Console</span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Staff Room</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col">
                <h1 className="font-semibold text-base text-zinc-100 tracking-tight">
                  Support with {agentName}
                </h1>
                <p className="text-xs text-zinc-400 font-normal">
                  Support session in progress
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Status Indicator */}
            {session && (
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                session.status === 'ACTIVE' 
                  ? 'bg-purple-950/40 text-purple-400 border border-purple-800/40' 
                  : session.status === 'ABANDONED'
                  ? 'bg-amber-950/40 text-amber-400 border border-amber-800/40'
                  : session.status === 'ENDED'
                  ? 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
              }`}>
                {session.status === 'ABANDONED' ? 'Paused' : session.status.toLowerCase()}
              </span>
            )}

            {/* Video Consultation Toggle (Customer-Only) */}
            {!isAgent && session?.status !== 'ENDED' && (
              <button
                onClick={() => setIsVideoCallOpen(!isVideoCallOpen)}
                className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 cursor-pointer ${
                  isVideoCallOpen
                    ? 'bg-purple-900/20 border-purple-800/40 text-purple-400 hover:bg-purple-900/30'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-850'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {isVideoCallOpen ? 'Hide Video' : 'Video Consultation'}
              </button>
            )}

            {isAgent && (
              <button
                onClick={refreshRoomData}
                className="px-3.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-all cursor-pointer"
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
          <div className="mb-6 p-4 rounded-xl bg-red-950/40 border border-red-900/30 text-red-200 text-sm flex gap-3 items-center">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>{error}</div>
          </div>
        )}

        {isAgent ? (
          /* AGENT VIEW: Two columns layout with event log at the bottom */
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left Column (8 cols): Media Room + Participants Roster */}
              <div className="lg:col-span-8 space-y-6">
                {resolvedUserId && resolvedRole ? (
                  <MediaRoom
                    sessionId={sessionId}
                    userId={resolvedUserId}
                    role={resolvedRole}
                    sessionStatus={session?.status || 'CREATED'}
                    onShareSupportLink={handleCopyLink}
                    onEndSupportSession={() => setShowEndSessionModal(true)}
                  />
                ) : (
                  <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 text-center text-zinc-500 text-xs">
                    Initializing secure stream...
                  </div>
                )}

                {/* Participant Roster */}
                <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 shadow-xl">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    Session Members
                  </h3>
                  
                  {participants.length === 0 ? (
                    <div className="py-8 text-center text-xs text-zinc-550 border border-dashed border-zinc-800 rounded-xl">
                      No members registered.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {participants.map((p) => {
                        const isMe = p.user_id === resolvedUserId && p.role.toLowerCase() === resolvedRole?.toLowerCase();
                        const isAgentRole = p.role.toLowerCase() === 'agent';
                        
                        let displayRole = 'Customer';
                        let badgeColor = 'bg-zinc-800/80 text-zinc-300 border-zinc-700/60';
                        if (isAgentRole) {
                          displayRole = 'Support Specialist';
                          badgeColor = 'bg-purple-950/40 text-purple-400 border-purple-800/40';
                        }
                        
                        let statusLabel = p.connection_status.toLowerCase();
                        let statusColor = 'bg-zinc-800 text-zinc-500';
                        let dotColor = 'bg-zinc-650';
                        if (p.connection_status === 'CONNECTED') {
                          statusColor = 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40';
                          dotColor = 'bg-emerald-500';
                        } else if (p.connection_status === 'DISCONNECTED') {
                          statusColor = 'bg-amber-950/40 text-amber-400 border-amber-800/40 animate-pulse';
                          dotColor = 'bg-amber-500';
                        }

                        return (
                          <div
                            key={p.id}
                            className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-850 flex flex-col justify-between gap-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3">
                                {/* Sleek Avatar */}
                                <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                                  {isAgentRole ? (
                                    <svg className="w-4.5 h-4.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                  ) : (
                                    <svg className="w-4.5 h-4.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-sm text-zinc-200 truncate flex items-center gap-1.5">
                                    <span>{p.user_id}</span>
                                    {isMe && (
                                      <span className="text-[9px] bg-zinc-900 text-zinc-550 px-1 py-0.5 rounded font-normal">You</span>
                                    )}
                                  </div>
                                  <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded border ${badgeColor} mt-1`}>
                                    {displayRole}
                                  </span>
                                </div>
                              </div>

                              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border flex items-center gap-1.5 ${statusColor}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                {statusLabel}
                              </span>
                            </div>

                            {session?.status !== 'ENDED' && (
                              <details className="group/memb-dev border-t border-zinc-900/40 pt-2">
                                <summary className="cursor-pointer select-none text-[8px] uppercase font-bold tracking-wider text-zinc-650 hover:text-zinc-500 transition-colors flex items-center gap-1">
                                  <svg className="w-2.5 h-2.5 group-open/memb-dev:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                  </svg>
                                  Developer Actions
                                </summary>
                                <div className="mt-2 flex gap-1.5">
                                  {p.connection_status === 'CONNECTED' && (
                                    <>
                                      <button
                                        onClick={() => handleDisconnect(p.id)}
                                        className="flex-1 py-1 rounded bg-zinc-900 hover:bg-zinc-850 text-[10px] font-semibold text-amber-400 transition-all cursor-pointer"
                                      >
                                        Disconnect
                                      </button>
                                      <button
                                        onClick={() => handleLeave(p.id)}
                                        className="flex-1 py-1 rounded bg-zinc-900 hover:bg-zinc-850 text-[10px] font-semibold text-red-400 transition-all cursor-pointer"
                                      >
                                        Leave
                                      </button>
                                    </>
                                  )}
                                  {p.connection_status === 'DISCONNECTED' && (
                                    <>
                                      <button
                                        onClick={() => handleReconnect(p.id)}
                                        className="flex-1 py-1 rounded bg-purple-950/40 hover:bg-purple-900/20 text-[10px] font-semibold text-purple-400 border border-purple-900/30 transition-all cursor-pointer"
                                      >
                                        Reconnect
                                      </button>
                                      <button
                                        onClick={() => handleLeave(p.id)}
                                        className="flex-1 py-1 rounded bg-zinc-900 hover:bg-zinc-850 text-[10px] font-semibold text-red-400 transition-all cursor-pointer"
                                      >
                                        Leave
                                      </button>
                                    </>
                                  )}
                                </div>
                              </details>
                            )}
                          </div>
                        );
                      })}
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
                  <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 shadow-xl">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                      Consultation Details
                    </h3>
                    
                    {/* Read customer / consultation details from localStorage if present on agent browser */}
                    {(() => {
                      const custName = typeof window !== 'undefined' ? (localStorage.getItem(`vq_consultation_${sessionId}_customerName`) || participants.find(p => p.role.toLowerCase() === 'customer')?.user_id || 'Customer') : 'Customer';
                      const issueCategory = typeof window !== 'undefined' ? (localStorage.getItem(`vq_consultation_${sessionId}_issueCategory`) || 'Support Consultation') : 'Support Consultation';
                      const internalNotes = typeof window !== 'undefined' ? (localStorage.getItem(`vq_consultation_${sessionId}_notes`) || '') : '';
                      return (
                        <div className="space-y-4">
                          <div className="space-y-3 text-xs">
                            <div className="flex justify-between py-1 border-b border-zinc-850">
                              <span className="text-zinc-500">Customer Name</span>
                              <span className="text-zinc-200 font-semibold">{custName}</span>
                            </div>
                            <div className="flex justify-between py-1 border-b border-zinc-850">
                              <span className="text-zinc-500">Issue Category</span>
                              <span className="text-zinc-350">{issueCategory}</span>
                            </div>
                            <div className="flex justify-between py-1 border-b border-zinc-850">
                              <span className="text-zinc-500">Assigned Agent</span>
                              <span className="text-zinc-300">{session.agent_id}</span>
                            </div>
                            <div className="flex justify-between py-1">
                              <span className="text-zinc-500">Started At</span>
                              <span className="text-zinc-400">{new Date(session.created_at).toLocaleTimeString()}</span>
                            </div>
                          </div>
                          {internalNotes && (
                            <div className="p-3 rounded-lg bg-zinc-950/40 border border-zinc-850 text-xs text-zinc-500 space-y-1">
                              <span className="block text-[9px] uppercase tracking-wider font-bold text-zinc-650">Internal Notes</span>
                              <p className="italic font-normal">"{internalNotes}"</p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Resolution Details for Finished Session */}
                    {session.status === 'ENDED' && (
                      <div className="mt-4 p-4 rounded-xl bg-zinc-950/50 border border-zinc-850 space-y-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-zinc-500 font-semibold uppercase tracking-wider text-[9px]">Outcome</span>
                          {(() => {
                            const outcome = typeof window !== 'undefined' ? localStorage.getItem(`vq_consultation_${sessionId}_resolutionStatus`) : 'RESOLVED';
                            const outcomeText = outcome ? outcome.toLowerCase() : 'completed';
                            const badgeStyle = outcome === 'RESOLVED' 
                              ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/30'
                              : outcome === 'ESCALATED'
                              ? 'bg-purple-950/40 text-purple-400 border border-purple-800/30'
                              : 'bg-red-950/40 text-red-400 border border-red-800/30';
                            return (
                              <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${badgeStyle}`}>
                                {outcomeText}
                              </span>
                            );
                          })()}
                        </div>
                        {(() => {
                          const notes = typeof window !== 'undefined' ? localStorage.getItem(`vq_consultation_${sessionId}_resolutionNotes`) : null;
                          if (!notes) return null;
                          return (
                            <div className="space-y-1 pt-2 border-t border-zinc-900">
                              <span className="block text-[8px] uppercase tracking-wider text-zinc-550 font-bold">Resolution Notes</span>
                              <p className="text-xs text-zinc-400 leading-relaxed italic">
                                "{notes}"
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Collapsible Developer Tools */}
                    <details className="mt-4 group/meta-dev border-t border-zinc-900/40 pt-3">
                      <summary className="cursor-pointer select-none text-[8px] uppercase font-bold tracking-wider text-zinc-650 hover:text-zinc-550 transition-colors flex items-center gap-1">
                        <svg className="w-2.5 h-2.5 group-open/meta-dev:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                        Developer Metadata
                      </summary>
                      <div className="mt-2 space-y-2 bg-zinc-950/80 p-3 rounded-lg border border-zinc-900 font-mono text-[9px] text-zinc-550 leading-normal">
                        <div className="flex justify-between">
                          <span className="text-zinc-650">Session ID:</span>
                          <span>{session.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-650">Invite Token:</span>
                          <span>{session.invite_token}</span>
                        </div>
                      </div>
                    </details>

                    {session.status !== 'ENDED' && (
                      <div className="mt-5 flex gap-2">
                        <button
                          onClick={handleCopyLink}
                          className="flex-1 py-2 px-3 rounded-xl bg-purple-950/40 hover:bg-purple-900/20 text-purple-400 border border-purple-900/30 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                          {copySuccess ? 'Copied!' : 'Invite Customer'}
                        </button>
                        <button
                          onClick={() => setShowEndSessionModal(true)}
                          className="py-2 px-4 rounded-xl bg-red-950/40 hover:bg-red-900/20 text-red-400 border border-red-900/30 text-xs font-semibold transition-all cursor-pointer"
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
            <details className="group border border-zinc-800 bg-zinc-900/30 shadow-xl overflow-hidden rounded-2xl">
              <summary className="p-6 cursor-pointer select-none flex items-center justify-between font-semibold text-xs uppercase tracking-wider text-zinc-450 hover:bg-zinc-900/40 transition-all">
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
                <div className="rounded-xl bg-zinc-950/80 border border-zinc-850 p-4 max-h-[300px] overflow-y-auto font-mono text-[11px] leading-relaxed space-y-3 scrollbar-thin">
                  {events.length === 0 ? (
                    <div className="text-center text-zinc-700 py-6">
                      No session events recorded.
                    </div>
                  ) : (
                    events.map((event) => (
                      <div key={event.id} className="pb-2.5 border-b border-zinc-900/40 last:border-0 last:pb-0">
                        <div className="flex justify-between items-center text-zinc-500">
                          <span className="text-purple-400 font-semibold">{event.event_type}</span>
                          <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="mt-1 text-zinc-400">
                          {event.metadata && Object.keys(event.metadata).length > 0 ? (
                            <pre className="p-2 rounded bg-zinc-900/40 text-zinc-400 overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(event.metadata)}
                            </pre>
                          ) : (
                            <span className="italic text-zinc-750">No metadata payload</span>
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
          /* CUSTOMER VIEW: Chat (Primary), Optional Video Call (Secondary) */
          <div className="w-full">
            {isVideoCallOpen && session?.status !== 'ENDED' ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Video Consultation Panel (8 Columns) - Primary Focus */}
                <div className="lg:col-span-8 w-full">
                  {resolvedUserId && resolvedRole ? (
                    <MediaRoom
                      sessionId={sessionId}
                      userId={resolvedUserId}
                      role={resolvedRole}
                      sessionStatus={session?.status || 'CREATED'}
                    />
                  ) : (
                    <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 text-center text-zinc-500 text-xs">
                      Initializing video consultation stream...
                    </div>
                  )}
                </div>

                {/* Chat Panel - Secondary Focus (4 Columns) */}
                <div className="lg:col-span-4 w-full">
                  <ChatPanel
                    messages={chatMessages}
                    participants={participants}
                    currentParticipantId={currentParticipantId}
                    sessionStatus={session?.status || 'CREATED'}
                    onSendMessage={handleSendMessage}
                  />
                </div>
              </div>
            ) : (
              /* Full-Width Chat Panel (Video Call Collapsed or Session Ended) */
              <div className="max-w-4xl mx-auto w-full">
                <ChatPanel
                  messages={chatMessages}
                  participants={participants}
                  currentParticipantId={currentParticipantId}
                  sessionStatus={session?.status || 'CREATED'}
                  onSendMessage={handleSendMessage}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {showEndSessionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6 relative animate-scale-in">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />
            
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-zinc-100">Complete Support Session</h3>
              <p className="text-zinc-400 text-sm">
                Specify the resolution outcome and provide concluding notes for this session.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <span className="block text-xs font-semibold uppercase tracking-wider text-zinc-455">Resolution Status</span>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'RESOLVED', label: 'Resolved' },
                    { id: 'ESCALATED', label: 'Escalated' },
                    { id: 'UNRESOLVED', label: 'Unresolved' }
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setResolutionStatus(opt.id)}
                      className={`p-3 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                        resolutionStatus === opt.id
                          ? opt.id === 'RESOLVED'
                            ? 'border-emerald-500 bg-emerald-950/30 text-emerald-350 shadow-md ring-1 ring-emerald-500'
                            : opt.id === 'ESCALATED'
                            ? 'border-purple-500 bg-purple-950/30 text-purple-350 shadow-md ring-1 ring-purple-500'
                            : 'border-red-500 bg-red-950/30 text-red-350 shadow-md ring-1 ring-red-500'
                          : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="resolutionNotes" className="block text-xs font-semibold uppercase tracking-wider text-zinc-455">
                  Resolution Notes (Optional)
                </label>
                <textarea
                  id="resolutionNotes"
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  rows={4}
                  placeholder="Summarize the solution, pending issues, or follow-up actions..."
                  className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-purple-500/80 focus:ring-1 focus:ring-purple-500/80 text-zinc-100 placeholder-zinc-700 outline-none transition-all text-sm resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowEndSessionModal(false);
                  setResolutionNotes('');
                  setResolutionStatus('RESOLVED');
                }}
                disabled={endingSession}
                className="flex-1 py-3 px-4 rounded-xl border border-zinc-800 text-zinc-300 font-medium text-sm hover:bg-zinc-850 active:scale-[0.99] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEndSession}
                disabled={endingSession}
                className="flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-medium text-sm shadow-lg shadow-red-950/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {endingSession ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Completing...
                  </>
                ) : (
                  'Complete Session'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

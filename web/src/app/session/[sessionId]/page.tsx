"use client";

import { use, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Session, Participant, SessionEvent, ChatMessage } from '@/lib/types';
import ChatPanel from '@/components/ChatPanel';
import MediaRoom from '@/components/MediaRoom';

const RoomViewState = {
  ACTIVE: 'ACTIVE',
  CUSTOMER_LEFT: 'CUSTOMER_LEFT',
  SESSION_ENDED: 'SESSION_ENDED',
  WAITING_FOR_CUSTOMER: 'WAITING_FOR_CUSTOMER',
  WAITING_FOR_AGENT: 'WAITING_FOR_AGENT',
} as const;
type RoomViewState = typeof RoomViewState[keyof typeof RoomViewState];

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

interface SupportProgressTrackerProps {
  currentStage: number; // 1, 2, 3, or 4
}

function SupportProgressTracker({ currentStage }: SupportProgressTrackerProps) {
  const stages = [
    { label: 'Support Request', desc: 'Received' },
    { label: 'Agent Joined', desc: 'Assigned' },
    { label: 'Consultation Active', desc: 'In Progress' },
    { label: 'Resolved', desc: 'Completed' }
  ];

  return (
    <div className="w-full bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 mb-8 shadow-md">
      <div className="grid grid-cols-4 gap-4 relative">
        {stages.map((stage, idx) => {
          const stageNum = idx + 1;
          const isCompleted = stageNum < currentStage;
          const isActive = stageNum === currentStage;

          let iconBg = 'bg-zinc-950 border-zinc-800 text-zinc-650';
          let textColor = 'text-zinc-500';

          if (isCompleted) {
            iconBg = 'bg-purple-950/60 border-purple-500/50 text-purple-400';
            textColor = 'text-purple-300';
          } else if (isActive) {
            iconBg = 'bg-purple-900 border-purple-500 text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]';
            textColor = 'text-zinc-200 font-semibold';
          }

          return (
            <div key={idx} className="relative flex flex-col items-center text-center">
              {/* Connector Line */}
              {idx < 3 && (
                <div 
                  className={`absolute top-4 left-[50%] right-[-50%] h-[2px] -translate-y-[50%] z-0 ${
                    stageNum < currentStage ? 'bg-purple-500/30' : 'bg-zinc-850'
                  }`}
                />
              )}
              
              {/* Step Circle */}
              <div className={`relative z-10 w-8 h-8 rounded-full border flex items-center justify-center text-xs font-mono transition-all duration-300 ${iconBg}`}>
                {isCompleted ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span>0{stageNum}</span>
                )}
              </div>
              
              {/* Step Text */}
              <div className="mt-2.5 space-y-0.5">
                <span className={`block text-[11px] leading-tight transition-colors duration-300 ${textColor}`}>
                  {stage.label}
                </span>
                <span className="block text-[9px] uppercase tracking-wider text-zinc-600 font-medium">
                  {stage.desc}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SessionRoomPage({ params }: PageProps) {
  const { sessionId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [localLeaveState, setLocalLeaveState] = useState<'none' | 'left'>('none');

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
  const [chatCollapsed, setChatCollapsed] = useState(false);

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

  // Redirect agent if session status transitions to ENDED on backend
  useEffect(() => {
    if (session?.status === 'ENDED' && resolvedRole === 'agent') {
      if (typeof window !== 'undefined') {
        localStorage.setItem('vq_toast_message', 'Support session completed.');
      }
      router.push('/agent');
    }
  }, [session?.status, resolvedRole, router]);

  // Sync localLeaveState with participant status from backend
  useEffect(() => {
    if (participants.length > 0 && resolvedUserId && resolvedRole === 'customer') {
      const customerPart = participants.find(
        p => p.user_id === resolvedUserId && p.role.toLowerCase() === 'customer'
      );
      if (customerPart?.connection_status === 'LEFT' && localLeaveState === 'none') {
        setLocalLeaveState('left');
      }
    }
  }, [participants, resolvedUserId, resolvedRole, localLeaveState]);

  // Derive RoomViewState
  const getRoomViewState = (): RoomViewState => {
    if (session?.status === 'ENDED') {
      return RoomViewState.SESSION_ENDED;
    }

    const hasAgentJoined = participants.some(
      p => p.role.toLowerCase() === 'agent' && p.connection_status === 'CONNECTED'
    );

    if (resolvedRole === 'customer') {
      if (localLeaveState === 'left') {
        return RoomViewState.CUSTOMER_LEFT;
      }
      if (!hasAgentJoined) {
        return RoomViewState.WAITING_FOR_AGENT;
      }
      return RoomViewState.ACTIVE;
    } else {
      // Agent
      const customerParticipant = participants.find(p => p.role.toLowerCase() === 'customer');
      if (!customerParticipant) {
        return RoomViewState.WAITING_FOR_CUSTOMER;
      }
      if (customerParticipant.connection_status === 'LEFT') {
        return RoomViewState.CUSTOMER_LEFT;
      }
      if (customerParticipant.connection_status === 'DISCONNECTED') {
        return RoomViewState.WAITING_FOR_CUSTOMER;
      }
      return RoomViewState.ACTIVE;
    }
  };

  const viewState = getRoomViewState();

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

      // If we left as ourselves, clear our local resolved identity (Staff only, or if session ended)
      if (pId === currentParticipantId && resolvedRole === 'agent') {
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
      await apiClient.endSession(sessionId, resolvedUserId || session.agent_id, resolutionStatus, resolutionNotes);
      if (typeof window !== 'undefined') {
        localStorage.setItem(`vq_consultation_${sessionId}_resolutionStatus`, resolutionStatus);
        localStorage.setItem(`vq_consultation_${sessionId}_resolutionNotes`, resolutionNotes);
        localStorage.setItem('vq_toast_message', 'Support session completed.');
      }
      setShowEndSessionModal(false);
      router.push('/agent');
    } catch (err: any) {
      setError(err.message || 'Failed to end session');
    } finally {
      setEndingSession(false);
    }
  };

  const handleRejoinSession = async () => {
    try {
      setError(null);
      if (session) {
        await apiClient.joinSession(sessionId, resolvedUserId!, 'customer', session.invite_token);
        setLocalLeaveState('none');
        setAutoJoinAttempted(false);
        await refreshRoomData();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to rejoin session');
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

  const customerName = typeof window !== 'undefined'
    ? (localStorage.getItem(`vq_consultation_${sessionId}_customerName`) || participants.find(p => p.role.toLowerCase() === 'customer')?.user_id || 'Customer')
    : 'Customer';

  const issueCategory = typeof window !== 'undefined'
    ? (localStorage.getItem(`vq_consultation_${sessionId}_issueCategory`) || localStorage.getItem(`vq_issue_${sessionId}`) || 'Support Consultation')
    : 'Support Consultation';

  const optionalNotes = typeof window !== 'undefined'
    ? (localStorage.getItem(`vq_consultation_${sessionId}_notes`) || '')
    : '';

  const getWaitingTimeLabel = () => {
    if (!session) return '0 minutes';
    const start = new Date(session.created_at).getTime();
    const end = session.started_at ? new Date(session.started_at).getTime() : Date.now();
    const diffMins = Math.max(0, Math.floor((end - start) / 60000));
    return `${diffMins} minutes`;
  };

  const getTimelineItems = () => {
    const items: { id: string; time: string; timestamp: Date; label: string; type: string }[] = [];

    const formatTime = (date: Date) => {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    let hasCustomerJoinedBefore = false;

    if (events && events.length > 0) {
      events.forEach((evt) => {
        let label = '';
        let type = 'info';
        const role = evt.metadata?.role || '';
        const friendlyName = role.toLowerCase() === 'agent' ? 'Support Specialist' : (customerName || 'Customer');

        switch (evt.event_type) {
          case 'SESSION_CREATED':
            label = 'Support request received';
            type = 'info';
            break;
          case 'SESSION_STARTED':
            label = 'Support session started';
            type = 'success';
            break;
          case 'SESSION_ENDED':
            label = 'Session ended';
            type = 'warning';
            break;
          case 'PARTICIPANT_JOINED':
            if (role.toLowerCase() === 'customer') {
              if (hasCustomerJoinedBefore) {
                label = 'Customer rejoined';
              } else {
                label = 'Customer joined';
                hasCustomerJoinedBefore = true;
              }
            } else {
              label = `${friendlyName} joined the conversation`;
            }
            type = 'info';
            break;
          case 'PARTICIPANT_LEFT':
            label = role.toLowerCase() === 'customer' ? 'Customer left' : `${friendlyName} left the conversation`;
            type = 'warning';
            break;
          case 'PARTICIPANT_DISCONNECTED':
            label = `${friendlyName} disconnected`;
            type = 'error';
            break;
          case 'PARTICIPANT_RECONNECTED':
            label = `${friendlyName} reconnected`;
            type = 'success';
            break;
          case 'ISSUE_RESOLVED':
            label = 'Issue resolved';
            type = 'success';
            break;
          case 'FOLLOW_UP_REQUESTED':
            label = 'Follow-up requested';
            type = 'warning';
            break;
          default:
            return;
        }

        if (label) {
          items.push({
            id: evt.id,
            time: formatTime(new Date(evt.timestamp)),
            timestamp: new Date(evt.timestamp),
            label,
            type,
          });
        }
      });
    } else {
      chatMessages
        .filter((msg) => msg.message_type === 'SYSTEM')
        .forEach((msg) => {
          let label = msg.content;
          let type = 'info';

          if (label.includes('joined the session')) {
            if (label.includes('Customer')) {
              if (hasCustomerJoinedBefore) {
                label = 'Customer rejoined';
              } else {
                label = 'Customer joined';
                hasCustomerJoinedBefore = true;
              }
            } else {
              label = label.replace('joined the session', 'joined the conversation');
              label = label.replace('Agent', 'Support Specialist');
            }
            type = 'info';
          } else if (label.includes('left the session')) {
            if (label.includes('Customer')) {
              label = 'Customer left';
            } else {
              label = label.replace('left the session', 'left the conversation');
              label = label.replace('Agent', 'Support Specialist');
            }
            type = 'warning';
          } else if (label.includes('reconnected')) {
            label = label.replace('Agent', 'Support Specialist');
            type = 'success';
          } else if (label.includes('Support session started')) {
            label = 'Support session started';
            type = 'success';
          } else if (label.includes('Support session resumed')) {
            label = 'Support session resumed';
            type = 'success';
          } else if (label.includes('Support session ended')) {
            label = 'Session ended';
            type = 'warning';
          } else if (label.includes('Issue resolved')) {
            label = 'Issue resolved';
            type = 'success';
          } else if (label.includes('Follow-up requested')) {
            label = 'Follow-up requested';
            type = 'warning';
          }

          items.push({
            id: msg.id,
            time: formatTime(new Date(msg.created_at)),
            timestamp: new Date(msg.created_at),
            label,
            type,
          });
        });
    }

    return items.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  };

  // 1. CUSTOMER WAITING SCREEN (No agent present in the conversation yet)
  if (viewState === RoomViewState.WAITING_FOR_AGENT) {
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

  const getActiveStep = () => {
    if (session?.status === 'ENDED') return 4;
    if (session?.status === 'ACTIVE' && session?.started_at) return 3;
    if (hasAgentJoined || session?.started_at) return 2;
    return 1;
  };

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
                  <span className="text-[10px] text-zinc-550 uppercase tracking-wider">Staff Room</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col">
                <h1 className="font-semibold text-base text-zinc-100 tracking-tight">
                  Support with {isAgent ? (session?.agent_id || 'Daksh') : (agentParticipant ? 'Daksh' : 'Support Agent')}
                </h1>
                <p className="text-xs text-zinc-550 font-normal">
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setChatCollapsed(!chatCollapsed)}
                  className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 cursor-pointer ${
                    chatCollapsed
                      ? 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-850'
                      : 'bg-purple-900/20 border-purple-800/40 text-purple-400 hover:bg-purple-900/30'
                  }`}
                >
                  {chatCollapsed ? 'Show Chat' : 'Hide Chat'}
                </button>
                <button
                  onClick={refreshRoomData}
                  className="px-3.5 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 text-xs font-semibold transition-all cursor-pointer"
                >
                  Refresh Connection
                </button>
              </div>
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

        {/* Support Step Journey Tracker */}
        <SupportProgressTracker currentStage={getActiveStep()} />

        {/* Customer Exit Screen */}
        {viewState === RoomViewState.CUSTOMER_LEFT && resolvedRole === 'customer' ? (
          <div className="w-full max-w-xl mx-auto p-8 sm:p-10 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl relative space-y-6 text-center my-12 animate-scale-in">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />
            <div className="w-12 h-12 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-zinc-100">You have left the support session.</h2>
              <p className="text-zinc-400 text-sm">
                The support request remains available if you need to rejoin.
              </p>
            </div>
            <div className="p-3 bg-zinc-955 border border-zinc-900 rounded-xl text-xs flex justify-between items-center text-zinc-400 max-w-sm mx-auto">
              <span>Session Status:</span>
              <span className="font-semibold text-amber-400">Waiting for Customer</span>
            </div>
            <div className="flex gap-3 pt-2 max-w-sm mx-auto">
              <button
                type="button"
                onClick={handleRejoinSession}
                className="flex-1 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-550 text-white font-medium text-xs shadow-md active:scale-95 transition-all cursor-pointer"
              >
                Rejoin Session
              </button>
              <Link
                href="/"
                className="flex-1 py-2.5 px-4 rounded-xl border border-zinc-800 text-zinc-350 hover:bg-zinc-850 text-xs font-semibold text-center block transition-all active:scale-95 cursor-pointer"
              >
                Return Home
              </Link>
            </div>
          </div>
        ) : viewState === RoomViewState.SESSION_ENDED && resolvedRole === 'customer' ? (
          <div className="w-full max-w-xl mx-auto p-8 sm:p-10 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl relative space-y-6 text-center my-12 animate-scale-in">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />
            <div className="w-12 h-12 rounded-full bg-emerald-950/40 border border-emerald-900/30 flex items-center justify-center mx-auto text-emerald-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-zinc-100">This support session has ended.</h2>
              <p className="text-zinc-400 text-sm">
                Thank you for contacting support.
              </p>
            </div>
            <div className="p-4 bg-zinc-955 border border-zinc-900 rounded-xl text-xs space-y-2 max-w-sm mx-auto text-left">
              <div className="flex justify-between py-0.5">
                <span className="text-zinc-550">Agent</span>
                <span className="font-semibold text-zinc-300">{agentName}</span>
              </div>
              <div className="flex justify-between py-0.5 border-t border-zinc-900 pt-1.5">
                <span className="text-zinc-550">Duration</span>
                <span className="font-semibold text-zinc-300">{getWaitingTimeLabel()}</span>
              </div>
              <div className="flex justify-between py-0.5 border-t border-zinc-900 pt-1.5">
                <span className="text-zinc-550">Status</span>
                <span className="font-semibold text-emerald-400">Completed</span>
              </div>
            </div>
            <div className="max-w-sm mx-auto pt-2">
              <Link
                href="/"
                className="w-full py-2.5 px-4 rounded-xl border border-zinc-800 text-zinc-355 hover:bg-zinc-850 text-xs font-semibold text-center block transition-all active:scale-95 cursor-pointer"
              >
                Return Home
              </Link>
            </div>
          </div>
        ) : (
          /* 2-Column Grid Layout */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left Column (Video Consultation + Metadata Cards) - occupies 8 columns (70% width) */}
            <div className="lg:col-span-8 space-y-6 w-full">
              {/* Video Consultation Area */}
              {resolvedUserId && resolvedRole && (session?.status !== 'ENDED' || isAgent) ? (
                <MediaRoom
                  sessionId={sessionId}
                  userId={resolvedUserId}
                  role={resolvedRole}
                  sessionStatus={session?.status || 'CREATED'}
                  customerLeft={participants.some(p => p.role.toLowerCase() === 'customer' && p.connection_status === 'LEFT')}
                  onShareSupportLink={handleCopyLink}
                  onEndSupportSession={() => setShowEndSessionModal(true)}
                  onLeaveCall={async () => {
                    setLocalLeaveState('left');
                    if (currentParticipantId) {
                      await handleLeave(currentParticipantId);
                    }
                  }}
                />
              ) : session?.status === 'ENDED' ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden shadow-xl shadow-black/40 flex flex-col p-8 items-center justify-center text-center min-h-[380px]">
                  <svg className="w-12 h-12 text-zinc-650 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-semibold text-zinc-300">Support Session Concluded</span>
                  <p className="text-xs text-zinc-550 max-w-[280px] mt-1.5 leading-relaxed">
                    This consultation has concluded. The support agent has resolved the issue.
                  </p>
                </div>
              ) : (
                <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 text-center text-zinc-550 text-xs">
                  Initializing video consultation stream...
                </div>
              )}

            {/* Sub-grid below video (Roster + Details) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Session Information Card (Both Customer & Agent) */}
              <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 shadow-xl space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  Support Session Details
                </h3>
                
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-1 border-b border-zinc-850">
                    <span className="text-zinc-500">Customer</span>
                    <span className="text-zinc-200 font-semibold">{customerName}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-850">
                    <span className="text-zinc-500">Agent</span>
                    <span className="text-zinc-200 font-semibold">{isAgent ? (session?.agent_id || 'Daksh') : (agentParticipant ? 'Daksh' : 'Support Agent')}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-850">
                    <span className="text-zinc-500">Category</span>
                    <span className="text-zinc-350">{issueCategory}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-850">
                    <span className="text-zinc-500">Status</span>
                    <span className={`font-semibold ${session?.status === 'ACTIVE' ? 'text-purple-400' : session?.status === 'ENDED' ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {session?.status === 'ACTIVE' ? 'In Progress' : session?.status === 'ENDED' ? 'Completed' : 'Waiting in Queue'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-500">Started At</span>
                    <span className="text-zinc-400">{session?.created_at ? new Date(session.created_at).toLocaleTimeString() : '--'}</span>
                  </div>
                </div>

                {optionalNotes && (
                  <div className="p-3 rounded-lg bg-zinc-950/40 border border-zinc-855 text-xs text-zinc-500 space-y-1">
                    <span className="block text-[9px] uppercase tracking-wider font-bold text-zinc-650">Customer Notes</span>
                    <p className="italic font-normal">"{optionalNotes}"</p>
                  </div>
                )}
                
                {/* Agent Call Controls (End Session button) */}
                {isAgent && session?.status !== 'ENDED' && (
                  <div className="pt-2 border-t border-zinc-850 flex gap-2">
                    <button
                      onClick={() => setShowEndSessionModal(true)}
                      className="w-full py-2.5 px-4 rounded-xl bg-red-950/60 hover:bg-red-900/30 text-red-400 border border-red-900/40 text-xs font-semibold transition-all cursor-pointer"
                    >
                      End Support Session
                    </button>
                  </div>
                )}
              </div>

              {/* Roster Registry card (Agent Only) */}
              {isAgent && (
                <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 shadow-xl space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                    Roster Registry
                  </h3>
                  
                  {participants.length === 0 ? (
                    <div className="text-zinc-655 text-xs py-4 text-center">
                      No participants registered.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {participants.map((p) => {
                        const isMe = p.id === currentParticipantId;
                        const displayRole = p.role.toUpperCase() === 'AGENT' ? 'Support Specialist' : 'Customer';
                        const badgeColor = p.role.toUpperCase() === 'AGENT'
                          ? 'bg-purple-950/40 text-purple-400 border-purple-900/30'
                          : 'bg-zinc-900 text-zinc-450 border-zinc-800';

                        const statusLabel = p.connection_status === 'CONNECTED' ? 'Online' : 'Offline';
                        const statusColor = p.connection_status === 'CONNECTED'
                          ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30'
                          : 'bg-zinc-955 text-zinc-550 border-zinc-900';
                        const dotColor = p.connection_status === 'CONNECTED' ? 'bg-emerald-500' : 'bg-zinc-750';

                        return (
                          <div key={p.id} className="p-3 rounded-xl bg-zinc-950/30 border border-zinc-850 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              {/* Avatar */}
                              <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-850 flex items-center justify-center text-zinc-550 shrink-0">
                                {p.role.toUpperCase() === 'AGENT' ? (
                                  <svg className="w-4 h-4 text-purple-455" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4 text-zinc-455" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-xs text-zinc-200 truncate flex items-center gap-1.5">
                                  <span>{p.role.toUpperCase() === 'AGENT' ? 'Support Specialist' : customerName}</span>
                                  {isMe && (
                                    <span className="text-[9px] bg-zinc-900 text-zinc-550 px-1 py-0.5 rounded font-normal">You</span>
                                  )}
                                </div>
                                <span className={`inline-block text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded border ${badgeColor} mt-1`}>
                                  {displayRole}
                                </span>
                              </div>
                            </div>

                            <span className={`text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border flex items-center gap-1.5 ${statusColor}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                              {statusLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Developer Tools (Collapsible, Agent Only) */}
            {isAgent && (
              <div className="p-4 rounded-xl bg-zinc-900/20 border border-zinc-800/40">
                <details className="group/dev-tools">
                  <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-zinc-505 hover:text-zinc-300 transition-colors flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 group-open/dev-tools:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                    Developer Tools
                  </summary>
                  
                  <div className="mt-4 space-y-4 pt-4 border-t border-zinc-850">
                    {/* Technical Metadata */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div className="p-3 bg-zinc-950/40 rounded-lg border border-zinc-850 space-y-1">
                        <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-555 block">Session ID</span>
                        <code className="text-[10px] text-zinc-300 font-mono select-all block break-all">{sessionId}</code>
                      </div>
                      <div className="p-3 bg-zinc-950/40 rounded-lg border border-zinc-855 space-y-1">
                        <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-555 block">Invite Token</span>
                        <code className="text-[10px] text-purple-300 font-mono select-all block break-all">{session?.invite_token || 'None'}</code>
                      </div>
                    </div>

                    {/* Member Controls */}
                    <div className="space-y-3">
                      <span className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-505 block">Roster Actions</span>
                      {participants.map((p) => (
                        <div key={p.id} className="p-2.5 rounded-lg bg-zinc-950/40 border border-zinc-850 flex items-center justify-between text-xs gap-3">
                          <span className="text-zinc-300 truncate font-mono">{p.user_id} ({p.role})</span>
                          <div className="flex gap-2">
                            {p.connection_status === 'CONNECTED' ? (
                              <>
                                <button
                                  onClick={() => handleDisconnect(p.id)}
                                  className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-850 text-[10px] font-semibold text-amber-400 border border-zinc-800 transition-all cursor-pointer"
                                >
                                  Disconnect Participant
                                </button>
                                <button
                                  onClick={() => handleLeave(p.id)}
                                  className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-850 text-[10px] font-semibold text-red-400 border border-zinc-800 transition-all cursor-pointer"
                                >
                                  Force Leave
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleReconnect(p.id)}
                                className="px-2 py-1 rounded bg-purple-950/40 hover:bg-purple-900/20 text-[10px] font-semibold text-purple-400 border border-purple-900/30 transition-all cursor-pointer"
                              >
                                Reconnect Participant
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              </div>
            )}

          </div>

          {/* Right Column (Chat Panel + Support Timeline) - occupies 4 columns (30% width) */}
          <div className="lg:col-span-4 space-y-6 w-full">
            {/* Chat Panel */}
            <div className="w-full">
              <ChatPanel
                messages={chatMessages}
                participants={participants}
                currentParticipantId={currentParticipantId}
                sessionStatus={session?.status || 'CREATED'}
                onSendMessage={handleSendMessage}
              />
            </div>

            {/* Support Timeline Card */}
            <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 shadow-xl space-y-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                Support Timeline
              </h3>
              
              <div className="relative pl-6 border-l border-zinc-800 space-y-6 ml-3">
                {getTimelineItems().map((item) => {
                  let typeColor = 'bg-zinc-855 text-zinc-450 border-zinc-800';
                  let dotColor = 'bg-zinc-650 ring-zinc-950';
                  let icon = (
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  );

                  if (item.type === 'success') {
                    typeColor = 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30';
                    dotColor = 'bg-emerald-500 ring-zinc-950';
                    icon = (
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    );
                  } else if (item.type === 'warning') {
                    typeColor = 'bg-amber-950/40 text-amber-400 border border-amber-900/30';
                    dotColor = 'bg-amber-500 ring-zinc-950';
                    icon = (
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    );
                  } else if (item.type === 'error') {
                    typeColor = 'bg-red-950/40 text-red-400 border border-red-900/30';
                    dotColor = 'bg-red-500 ring-zinc-950';
                    icon = (
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    );
                  }

                  return (
                    <div key={item.id} className="relative flex items-center justify-between gap-4">
                      {/* Timeline Dot */}
                      <span className={`absolute -left-[35px] w-5 h-5 rounded-full ring-4 flex items-center justify-center ${dotColor} ${typeColor}`}>
                        {icon}
                      </span>
                      <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                        <span className="text-zinc-200 font-medium">{item.label}</span>
                        <span className="text-[10px] text-zinc-500 font-mono shrink-0">{item.time}</span>
                      </div>
                    </div>
                  );
                })}

                {getTimelineItems().length === 0 && (
                  <div className="text-zinc-650 text-xs py-4 text-center">
                    No events recorded.
                  </div>
                )}
              </div>
            </div>

          </div>

        </div>
        )}
      </main>

      {showEndSessionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6 relative animate-scale-in">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />
            
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-zinc-100">End Support Session?</h3>
              <p className="text-zinc-400 text-sm">
                This will close the consultation for all participants.
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
                  'End Session'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

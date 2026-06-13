"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Session, Participant } from '@/lib/types';

export default function AgentDashboard() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [participantsMap, setParticipantsMap] = useState<Record<string, Participant[]>>({});
  const [agentId, setAgentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New Consultation Form States
  const [customerName, setCustomerName] = useState('');
  const [issueCategory, setIssueCategory] = useState('Technical Support');
  const [optionalNotes, setOptionalNotes] = useState('');

  // UI state
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
  const [consultationDetails, setConsultationDetails] = useState<Record<string, { customerName: string; issueCategory: string; notes: string }>>({});

  // End Session Resolution Modal States
  const [endingSessionId, setEndingSessionId] = useState<string | null>(null);
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);
  const [resolutionStatus, setResolutionStatus] = useState('RESOLVED');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [endingSession, setEndingSession] = useState(false);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.getSessions();
      // Sort sessions: newest first
      const sorted = [...res.sessions].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setSessions(sorted);
    } catch (err: any) {
      setError(err.message || 'Failed to sync dashboard consultations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedUserId = localStorage.getItem('vq_auth_userId');
      const savedRole = localStorage.getItem('vq_auth_role');
      if (!savedUserId || savedRole !== 'agent') {
        router.push('/agent/login');
      } else {
        setAgentId(savedUserId);
        fetchSessions();
      }
    }
  }, [router]);

  // Fetch participants for all sessions to determine friendly status
  useEffect(() => {
    const fetchAllParticipants = async () => {
      const newMap: Record<string, Participant[]> = {};
      await Promise.all(
        sessions.map(async (s) => {
          try {
            const parts = await apiClient.getSessionParticipants(s.id);
            newMap[s.id] = parts;
          } catch (e) {
            console.error(`Failed to fetch participants for session ${s.id}`, e);
          }
        })
      );
      setParticipantsMap(prev => ({ ...prev, ...newMap }));
    };

    if (sessions.length > 0) {
      fetchAllParticipants();
    }
  }, [sessions]);

  // Read consultation details from localStorage client-side to prevent hydration mismatch
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const details: Record<string, { customerName: string; issueCategory: string; notes: string }> = {};
      sessions.forEach(s => {
        const name = localStorage.getItem(`vq_consultation_${s.id}_customerName`) || '';
        const category = localStorage.getItem(`vq_consultation_${s.id}_issueCategory`) || 'General Consultation';
        const notes = localStorage.getItem(`vq_consultation_${s.id}_notes`) || '';
        details[s.id] = { customerName: name, issueCategory: category, notes };
      });
      setConsultationDetails(details);
    }
  }, [sessions]);

  const handleStartConsultation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId.trim() || !customerName.trim()) return;

    try {
      setError(null);
      const newSession = await apiClient.createSession(agentId);
      
      // Store new consultation metadata in localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem(`vq_consultation_${newSession.id}_customerName`, customerName.trim());
        localStorage.setItem(`vq_consultation_${newSession.id}_issueCategory`, issueCategory);
        localStorage.setItem(`vq_consultation_${newSession.id}_notes`, optionalNotes.trim());
      }
      
      // Clear form inputs
      setCustomerName('');
      setOptionalNotes('');
      setIssueCategory('Technical Support');

      await fetchSessions();
    } catch (err: any) {
      setError(err.message || 'Failed to start consultation');
    }
  };

  const handleEndSession = (sessionId: string) => {
    setEndingSessionId(sessionId);
    setShowEndSessionModal(true);
  };

  const handleEndSessionSubmit = async () => {
    if (!endingSessionId) return;
    try {
      setEndingSession(true);
      setError(null);
      await apiClient.endSession(endingSessionId, agentId, resolutionStatus, resolutionNotes);
      if (typeof window !== 'undefined') {
        localStorage.setItem(`vq_consultation_${endingSessionId}_resolutionStatus`, resolutionStatus);
        localStorage.setItem(`vq_consultation_${endingSessionId}_resolutionNotes`, resolutionNotes);
      }
      setShowEndSessionModal(false);
      setEndingSessionId(null);
      setResolutionStatus('RESOLVED');
      setResolutionNotes('');
      await fetchSessions();
    } catch (err: any) {
      setError(err.message || 'Failed to end consultation');
    } finally {
      setEndingSession(false);
    }
  };

  const handleCopyLink = (session: Session) => {
    if (typeof window === 'undefined') return;
    const link = `${window.location.origin}/join/${session.invite_token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedSessionId(session.id);
      setTimeout(() => setCopiedSessionId(null), 3000);
    });
  };

  // Status mapping logic
  const getFriendlyStatus = (session: Session, sessionParticipants: Participant[] = []) => {
    if (session.status === 'ENDED') {
      return 'Support Session Completed';
    }
    if (session.status === 'ABANDONED') {
      return 'Waiting For Customer';
    }

    const hasCustomerConnected = sessionParticipants.some(
      (p) => p.role.toUpperCase() === 'CUSTOMER' && p.connection_status === 'CONNECTED'
    );
    const hasCustomerJoined = sessionParticipants.some(
      (p) => p.role.toUpperCase() === 'CUSTOMER'
    );

    if (session.status === 'CREATED') {
      if (hasCustomerConnected) {
        return 'Waiting For Agent';
      }
      if (hasCustomerJoined) {
        return 'Waiting For Customer';
      }
      return 'Support Request Created';
    }

    if (session.status === 'ACTIVE') {
      if (hasCustomerConnected) {
        return 'Video Consultation Active';
      }
      return 'Consultation In Progress';
    }

    return 'Waiting For Customer';
  };

  // Status badge styling mapper
  const getStatusBadgeStyle = (friendlyStatus: string) => {
    switch (friendlyStatus) {
      case 'Support Session Completed':
        return 'bg-zinc-900 text-zinc-500 border border-zinc-850';
      case 'Waiting For Customer':
      case 'Waiting For Agent':
        return 'bg-amber-950/40 text-amber-400 border border-amber-800/30';
      case 'Video Consultation Active':
        return 'bg-purple-950/40 text-purple-400 border border-purple-800/30';
      case 'Consultation In Progress':
        return 'bg-indigo-950/40 text-indigo-400 border border-indigo-800/30';
      case 'Support Request Created':
      default:
        return 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/30';
    }
  };

  const getFriendlyTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'Just now';
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Started ${minutes} min${minutes > 1 ? 's' : ''} ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Started ${hours} hour${hours > 1 ? 's' : ''} ago`;
    
    return `Started on ${date.toLocaleDateString()}`;
  };

  // Partition sessions
  const activeSessions = sessions.filter(s => s.status !== 'ENDED');
  const finishedSessions = sessions.filter(s => s.status === 'ENDED');

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-purple-600 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-zinc-850 bg-zinc-900/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-bold bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              Support Dashboard
            </h1>
            <p className="text-zinc-500 text-xs font-medium">
              Manage customer consultations and active support sessions.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
            <span className="text-[10px] text-zinc-550 uppercase tracking-widest font-semibold">Workspace Active</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-950/40 border border-red-900/30 text-red-200 text-sm flex gap-3 items-center">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>{error}</div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Primary Action Card: Left Side (5 Columns) */}
          <div className="lg:col-span-5">
            <div className="p-6 sm:p-8 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur-md shadow-2xl relative">
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />
              
              <h2 className="text-lg font-semibold text-zinc-100 mb-2">
                Start New Support Consultation
              </h2>
              <p className="text-zinc-500 text-xs mb-6 leading-relaxed">
                Initialize a new active consultation window for an incoming customer request.
              </p>
              
              <form onSubmit={handleStartConsultation} className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="customerName" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Customer Name
                  </label>
                  <input
                    id="customerName"
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    required
                    placeholder="e.g. John Smith"
                    className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-purple-500/80 focus:ring-1 focus:ring-purple-500/80 text-zinc-100 placeholder-zinc-700 outline-none transition-all text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="issueCategory" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Issue Category
                  </label>
                  <select
                    id="issueCategory"
                    value={issueCategory}
                    onChange={(e) => setIssueCategory(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-purple-500/80 focus:ring-1 focus:ring-purple-500/80 text-zinc-100 outline-none transition-all text-sm cursor-pointer"
                  >
                    <option value="Technical Support">Technical Support</option>
                    <option value="Billing & Accounts">Billing & Accounts</option>
                    <option value="Product Setup">Product Setup</option>
                    <option value="General Inquiry">General Inquiry</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="optionalNotes" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Optional Notes (Internal)
                  </label>
                  <textarea
                    id="optionalNotes"
                    value={optionalNotes}
                    onChange={(e) => setOptionalNotes(e.target.value)}
                    rows={3}
                    placeholder="Write private notes about this consultation..."
                    className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-purple-500/80 focus:ring-1 focus:ring-purple-500/80 text-zinc-100 placeholder-zinc-700 outline-none transition-all text-sm resize-none"
                  />
                </div>

                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-850 text-xs flex justify-between items-center text-zinc-500">
                  <span>Assigned Agent:</span>
                  <span className="text-zinc-300 font-semibold">{agentId}</span>
                </div>

                <button
                  type="submit"
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-sm shadow-lg shadow-purple-950/20 active:scale-[0.99] transition-all cursor-pointer"
                >
                  Create Consultation
                </button>
              </form>
            </div>
          </div>

          {/* Consultation Lists: Right Side (7 Columns) */}
          <div className="lg:col-span-7 space-y-8">
            {/* 1. Active Consultations Panel */}
            <div className="p-6 sm:p-8 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 shadow-2xl relative">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-zinc-200">
                  Active Consultations
                </h2>
                
                {/* Sync Button */}
                <button
                  onClick={fetchSessions}
                  disabled={loading}
                  className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 transition-all disabled:opacity-50 cursor-pointer"
                  title="Reload Consultations"
                >
                  <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.253 8H18" />
                  </svg>
                </button>
              </div>

              {activeSessions.length === 0 ? (
                <div className="py-12 text-center rounded-xl bg-zinc-950/20 border border-dashed border-zinc-850">
                  <svg className="w-10 h-10 mx-auto text-zinc-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                  </svg>
                  <h3 className="text-sm font-medium text-zinc-400">No active consultations</h3>
                  <p className="text-xs text-zinc-550 mt-1">Start a new support consultation on the left to begin.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeSessions.map((session) => {
                    const sessionParts = participantsMap[session.id] || [];
                    const friendlyStatus = getFriendlyStatus(session, sessionParts);
                    const nameFallback = sessionParts.find(p => p.role.toUpperCase() === 'CUSTOMER')?.user_id || 'Customer';
                    
                    const details = consultationDetails[session.id] || {
                      customerName: nameFallback,
                      issueCategory: 'General Consultation',
                      notes: ''
                    };

                    const name = details.customerName || nameFallback;
                    const category = details.issueCategory || 'General Consultation';
                    const notes = details.notes || '';

                    return (
                      <div
                        key={session.id}
                        className="p-5 rounded-xl bg-zinc-950/60 border border-zinc-850 hover:border-zinc-800/60 transition-all flex flex-col md:flex-row md:items-center justify-between gap-5 relative group"
                      >
                        <div className="space-y-3 flex-1">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="font-semibold text-base text-zinc-100">
                              {name}
                            </span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${getStatusBadgeStyle(friendlyStatus)}`}>
                              {friendlyStatus}
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 font-medium">
                            <span className="text-zinc-400">
                              {category}
                            </span>
                            <span>
                              {getFriendlyTimeAgo(session.created_at)}
                            </span>
                          </div>

                          {notes && (
                            <p className="text-zinc-500 text-xs italic bg-zinc-950/20 p-2.5 rounded border border-zinc-900/60 max-w-xl">
                              "{notes}"
                            </p>
                          )}

                          {/* Developer Tools inside collapsed details tag */}
                          <details className="text-xs text-zinc-650 mt-2 border-t border-zinc-900/60 pt-2 group/dev">
                            <summary className="cursor-pointer select-none text-[9px] uppercase font-bold tracking-wider text-zinc-655 hover:text-zinc-500 transition-colors flex items-center gap-1">
                              <svg className="w-3 h-3 group-open/dev:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                              </svg>
                              Developer Tools
                            </summary>
                            <div className="mt-2 space-y-1.5 bg-zinc-950/90 p-3 rounded border border-zinc-900/80 font-mono text-[10px] text-zinc-500 leading-normal">
                              <div><span className="text-zinc-650">Session ID:</span> {session.id}</div>
                              <div><span className="text-zinc-650">Invite Token:</span> {session.invite_token}</div>
                              <div><span className="text-zinc-650">Raw status:</span> {session.status}</div>
                              <div className="pt-1.5 mt-1.5 border-t border-zinc-900 flex gap-2">
                                <button
                                  onClick={() => handleEndSession(session.id)}
                                  className="text-red-400 hover:text-red-355 hover:underline cursor-pointer"
                                >
                                  End Session (Force)
                                </button>
                              </div>
                            </div>
                          </details>
                        </div>

                        {/* Actions block */}
                        <div className="flex flex-row md:flex-col items-stretch md:items-end justify-start md:justify-center gap-2.5 shrink-0">
                          <Link
                            href={`/session/${session.id}?role=agent&userId=${session.agent_id}`}
                            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-505 text-white font-medium text-xs shadow-md shadow-purple-950/10 active:scale-95 transition-all text-center cursor-pointer"
                          >
                            Open Consultation
                          </Link>
                          
                          <button
                            onClick={() => handleCopyLink(session)}
                            className={`px-4 py-2 rounded-xl border text-xs font-semibold transition-all active:scale-95 text-center cursor-pointer ${
                              copiedSessionId === session.id
                                ? 'bg-emerald-950/40 border-emerald-900/30 text-emerald-400'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-850'
                            }`}
                          >
                            {copiedSessionId === session.id ? 'Support link copied successfully' : 'Share Support Link'}
                          </button>

                          <button
                            onClick={() => handleEndSession(session.id)}
                            className="px-4 py-2 rounded-xl bg-red-950/40 hover:bg-red-900/30 text-red-400 border border-red-900/30 font-medium text-xs active:scale-95 transition-all cursor-pointer"
                          >
                            Complete Session
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 2. Finished Consultations Panel */}
            <div className="p-6 sm:p-8 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 shadow-2xl relative">
              <h2 className="text-lg font-semibold text-zinc-200 mb-6">
                Finished Consultations
              </h2>

              {finishedSessions.length === 0 ? (
                <div className="py-8 text-center rounded-xl bg-zinc-950/10 border border-dashed border-zinc-900 text-zinc-600 text-xs">
                  No completed consultations yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {finishedSessions.map((session) => {
                    const sessionParts = participantsMap[session.id] || [];
                    const friendlyStatus = getFriendlyStatus(session, sessionParts);
                    const nameFallback = sessionParts.find(p => p.role.toUpperCase() === 'CUSTOMER')?.user_id || 'Customer';
                    
                    const details = consultationDetails[session.id] || {
                      customerName: nameFallback,
                      issueCategory: 'General Consultation',
                      notes: ''
                    };

                    const name = details.customerName || nameFallback;
                    const category = details.issueCategory || 'General Consultation';
                    const notes = details.notes || '';

                    return (
                      <div
                        key={session.id}
                        className="p-5 rounded-xl bg-zinc-950/30 border border-zinc-900 hover:border-zinc-850/60 transition-all flex flex-col md:flex-row md:items-center justify-between gap-5 relative"
                      >
                        <div className="space-y-2 flex-1">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="font-semibold text-sm text-zinc-350">
                              {name}
                            </span>
                            <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${getStatusBadgeStyle(friendlyStatus)}`}>
                              {friendlyStatus}
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-550">
                            <span>{category}</span>
                            <span>{getFriendlyTimeAgo(session.created_at)}</span>
                          </div>

                          {notes && (
                            <p className="text-zinc-600 text-xs italic bg-zinc-950/10 p-2 rounded max-w-xl">
                              "{notes}"
                            </p>
                          )}

                          {/* Resolution Outcome Details */}
                          {(() => {
                            const resStatus = typeof window !== 'undefined' ? localStorage.getItem(`vq_consultation_${session.id}_resolutionStatus`) : null;
                            const resNotes = typeof window !== 'undefined' ? localStorage.getItem(`vq_consultation_${session.id}_resolutionNotes`) : null;
                            if (!resStatus && !resNotes) return null;
                            
                            const statusColor = resStatus === 'RESOLVED'
                              ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30'
                              : resStatus === 'ESCALATED'
                              ? 'bg-purple-950/40 text-purple-400 border border-purple-800/30'
                              : 'bg-red-950/40 text-red-400 border border-red-800/30';
                              
                            return (
                              <div className="mt-3 p-3 rounded-xl bg-zinc-950/40 border border-zinc-900/60 space-y-1.5 max-w-xl">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] uppercase tracking-wider text-zinc-550 font-bold">Outcome:</span>
                                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusColor}`}>
                                    {resStatus?.toLowerCase() || 'completed'}
                                  </span>
                                </div>
                                {resNotes && (
                                  <p className="text-xs text-zinc-400 font-normal italic">
                                    "{resNotes}"
                                  </p>
                                )}
                              </div>
                            );
                          })()}

                          {/* Developer Tools inside collapsed details tag */}
                          <details className="text-xs text-zinc-650 mt-2 border-t border-zinc-900/40 pt-2 group/dev">
                            <summary className="cursor-pointer select-none text-[8px] uppercase font-bold tracking-wider text-zinc-650 hover:text-zinc-550 transition-colors flex items-center gap-1">
                              <svg className="w-2.5 h-2.5 group-open/dev:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                              </svg>
                              Developer Tools
                            </summary>
                            <div className="mt-2 space-y-1 bg-zinc-950/90 p-3 rounded border border-zinc-900/80 font-mono text-[9px] text-zinc-550 leading-normal">
                              <div><span className="text-zinc-700">Session ID:</span> {session.id}</div>
                              <div><span className="text-zinc-700">Invite Token:</span> {session.invite_token}</div>
                              <div><span className="text-zinc-700">Raw status:</span> {session.status}</div>
                            </div>
                          </details>
                        </div>

                        {/* View Chat History Action */}
                        <div className="shrink-0">
                          <Link
                            href={`/session/${session.id}?role=agent&userId=${session.agent_id}`}
                            className="px-4 py-2 rounded-xl border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 font-medium text-xs transition-all text-center block cursor-pointer"
                          >
                            View Chat History
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
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
                  setEndingSessionId(null);
                }}
                disabled={endingSession}
                className="flex-1 py-3 px-4 rounded-xl border border-zinc-800 text-zinc-300 font-medium text-sm hover:bg-zinc-850 active:scale-[0.99] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEndSessionSubmit}
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

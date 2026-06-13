"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Session } from '@/lib/types';

export default function AgentDashboard() {
  const router = useRouter();
  const [waitingRequests, setWaitingRequests] = useState<Session[]>([]);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [sessionHistory, setSessionHistory] = useState<Session[]>([]);
  const [agentId, setAgentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [waitingRes, activeRes, historyRes] = await Promise.all([
        apiClient.getSessions('CREATED', true),
        apiClient.getSessions('ACTIVE'),
        apiClient.getSessions('ENDED'),
      ]);
      setWaitingRequests(waitingRes.sessions);
      setActiveSessions(activeRes.sessions);
      setSessionHistory(historyRes.sessions);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch dashboard data');
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
        fetchDashboardData();
        // Set up poll every 5 seconds for live incoming requests
        const interval = setInterval(fetchDashboardData, 5000);
        return () => clearInterval(interval);
      }
    }
  }, [router]);

  const handleAcceptSession = async (sessionId: string) => {
    try {
      setError(null);
      await apiClient.acceptSession(sessionId);
      router.push(`/session/${sessionId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to accept session');
    }
  };

  const getWaitTime = (createdAtStr: string) => {
    const created = new Date(createdAtStr).getTime();
    const now = Date.now();
    const diffSec = Math.floor((now - created) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    return `${diffMin}m ago`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white">
      {/* Header */}
      <header className="border-b border-zinc-850 bg-zinc-900/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center font-bold text-zinc-900">
              VQ
            </div>
            <span className="font-semibold text-zinc-100">
              VideoQuest Agent Workspace
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs text-zinc-400 font-medium">{agentId} (Agent)</span>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('vq_auth_userId');
                localStorage.removeItem('vq_auth_role');
                localStorage.removeItem('vq_auth_token');
                router.push('/agent/login');
              }}
              className="text-xs text-zinc-500 hover:text-zinc-350 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        {error && (
          <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/30 text-red-400 text-sm flex gap-3 items-center">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>{error}</div>
          </div>
        )}

        {/* 1. Waiting Requests */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-zinc-200 flex items-center gap-2.5">
              Waiting Requests
              {waitingRequests.length > 0 && (
                <span className="px-2 py-0.5 text-xs font-semibold bg-zinc-800 text-zinc-300 rounded-full">
                  {waitingRequests.length}
                </span>
              )}
            </h2>
            {loading && (
              <span className="text-xs text-zinc-500 animate-pulse">Syncing...</span>
            )}
          </div>

          {waitingRequests.length === 0 ? (
            <div className="py-10 text-center rounded-2xl bg-zinc-900/20 border border-zinc-850">
              <p className="text-sm text-zinc-500">No waiting support requests.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {waitingRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-850 hover:border-zinc-800 transition-all flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <h3 className="font-medium text-sm text-zinc-200">{req.customer_name}</h3>
                      <span className="text-[11px] text-zinc-500">{getWaitTime(req.created_at)}</span>
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed">
                      {req.issue_description}
                    </p>
                  </div>

                  <button
                    onClick={() => handleAcceptSession(req.id)}
                    className="w-full py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-medium text-xs transition-all active:scale-[0.98]"
                  >
                    Accept Session
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 2. Active Sessions */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-zinc-200">Active Sessions</h2>
          {activeSessions.length === 0 ? (
            <div className="py-10 text-center rounded-2xl bg-zinc-900/20 border border-zinc-850">
              <p className="text-sm text-zinc-500">No active support sessions.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeSessions.map((session) => (
                <div
                  key={session.id}
                  className="p-4 rounded-xl bg-zinc-900/30 border border-zinc-850 flex items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm text-zinc-250">
                        {session.customer_name || 'Customer'}
                      </span>
                      <span className="text-xs text-zinc-500">
                        Assigned to: {session.agent_id}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 truncate max-w-md">
                      {session.issue_description || 'No description'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => router.push(`/session/${session.id}`)}
                      className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs transition-all"
                    >
                      Join Room
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. Session History */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-zinc-200">Session History</h2>
          {sessionHistory.length === 0 ? (
            <div className="py-10 text-center rounded-2xl bg-zinc-900/20 border border-zinc-850">
              <p className="text-sm text-zinc-500">No ended sessions.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-850 overflow-hidden bg-zinc-900/10">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-850 bg-zinc-900/30 text-zinc-400 font-medium">
                    <th className="p-4">Customer</th>
                    <th className="p-4">Issue Description</th>
                    <th className="p-4">Resolved By</th>
                    <th className="p-4">Ended At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850 text-zinc-350">
                  {sessionHistory.slice(0, 10).map((session) => (
                    <tr key={session.id} className="hover:bg-zinc-900/10 transition-colors">
                      <td className="p-4 font-medium text-zinc-300">{session.customer_name || 'Customer'}</td>
                      <td className="p-4 truncate max-w-xs">{session.issue_description || 'N/A'}</td>
                      <td className="p-4">{session.agent_id}</td>
                      <td className="p-4 text-zinc-500">
                        {session.ended_at ? new Date(session.ended_at).toLocaleString() : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

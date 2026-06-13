"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { Session } from '@/lib/types';

export default function AgentDashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agentId, setAgentId] = useState('agent_default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(err.message || 'Failed to fetch sessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId.trim()) return;

    try {
      setError(null);
      await apiClient.createSession(agentId);
      await fetchSessions();
    } catch (err: any) {
      setError(err.message || 'Failed to create session');
    }
  };

  const handleEndSession = async (sessionId: string) => {
    if (!confirm('Are you sure you want to end this session?')) return;
    try {
      setError(null);
      await apiClient.endSession(sessionId, agentId);
      await fetchSessions();
    } catch (err: any) {
      setError(err.message || 'Failed to end session');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
              VQ
            </div>
            <span className="font-semibold text-lg bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              VideoQuest Agent Console
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-zinc-400 font-medium">Gateway Active</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-950/50 border border-red-800/50 text-red-200 text-sm flex gap-3 items-center">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>{error}</div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Create Session Form */}
          <div className="lg:col-span-1">
            <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-xl shadow-black/40">
              <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-zinc-100 to-zinc-300 bg-clip-text text-transparent">
                Create Session
              </h2>
              <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
                Initialize a new real-time video session. The system will automatically generate a secure customer invite link.
              </p>
              
              <form onSubmit={handleCreateSession} className="space-y-4">
                <div>
                  <label htmlFor="agentId" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                    Agent Identifier
                  </label>
                  <input
                    id="agentId"
                    type="text"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    required
                    placeholder="e.g. agent_alice"
                    className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-zinc-100 placeholder-zinc-600 outline-none transition-all"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all"
                >
                  Generate Session
                </button>
              </form>
            </div>
          </div>

          {/* Sessions List */}
          <div className="lg:col-span-2">
            <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-xl shadow-black/40">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold bg-gradient-to-r from-zinc-100 to-zinc-300 bg-clip-text text-transparent">
                  Active Sessions
                </h2>
                <button
                  onClick={fetchSessions}
                  disabled={loading}
                  className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-all disabled:opacity-50"
                  title="Reload Session List"
                >
                  <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.253 8H18" />
                  </svg>
                </button>
              </div>

              {sessions.length === 0 ? (
                <div className="py-12 text-center rounded-xl bg-zinc-950/40 border border-dashed border-zinc-800">
                  <svg className="w-12 h-12 mx-auto text-zinc-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <h3 className="text-sm font-semibold text-zinc-300">No sessions generated</h3>
                  <p className="text-xs text-zinc-500 mt-1">Create a session using the form on the left to begin.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="p-5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-700/60 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                            {session.id.slice(0, 8)}...
                          </span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            session.status === 'ACTIVE' 
                              ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/40' 
                              : session.status === 'ENDED'
                              ? 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                              : 'bg-indigo-950/50 text-indigo-400 border border-indigo-800/40'
                          }`}>
                            {session.status}
                          </span>
                        </div>
                        <div className="text-zinc-500 text-xs mt-1">
                          Created by Agent: <span className="text-zinc-300 font-medium">{session.agent_id}</span>
                        </div>
                        <div className="flex flex-col gap-0.5 mt-2">
                          <span className="text-[11px] text-zinc-600">
                            Created: {new Date(session.created_at).toLocaleString()}
                          </span>
                          {session.started_at && (
                            <span className="text-[11px] text-zinc-600">
                              Activated: {new Date(session.started_at).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {session.status !== 'ENDED' && (
                          <Link
                            href={`/session/${session.id}?role=agent&userId=${session.agent_id}`}
                            className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/10 active:scale-95 transition-all"
                          >
                            Join as Agent
                          </Link>
                        )}
                        <Link
                          href={`/session/${session.id}`}
                          className="px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 font-medium text-xs active:scale-95 transition-all"
                        >
                          View Room
                        </Link>
                        {session.status !== 'ENDED' ? (
                          <button
                            onClick={() => handleEndSession(session.id)}
                            className="px-3.5 py-2 rounded-lg bg-red-950/40 hover:bg-red-900/30 text-red-400 border border-red-900/30 font-medium text-xs active:scale-95 transition-all"
                          >
                            End
                          </button>
                        ) : (
                          <span className="text-xs text-zinc-600 px-3.5 py-2">Archived</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

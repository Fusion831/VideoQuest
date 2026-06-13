"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

export default function AgentLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('demo_agent');
  const [password, setPassword] = useState('demo123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear any existing auth on load
  useEffect(() => {
    localStorage.removeItem('vq_auth_userId');
    localStorage.removeItem('vq_auth_role');
    localStorage.removeItem('vq_auth_token');
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    try {
      setLoading(true);
      setError(null);
      await apiClient.login(username, password);
      router.push('/agent');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-955 text-zinc-100 font-sans flex flex-col items-center justify-center p-4 selection:bg-indigo-500 selection:text-white">
      <div className="w-full max-w-md p-8 rounded-3xl bg-zinc-900 border border-zinc-800/80 shadow-2xl shadow-black/80 relative overflow-hidden">
        {/* Glow accents */}
        <div className="absolute -top-20 -left-20 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Brand / Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20 mx-auto mb-4 text-xl">
            VQ
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-zinc-100 to-zinc-300 bg-clip-text text-transparent">
            Agent Console Login
          </h1>
          <p className="text-zinc-500 text-xs mt-2">
            Secure agent gateway credentials required
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-950/50 border border-red-800/50 text-red-200 text-xs flex gap-3 items-center">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>{error}</div>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="username" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="e.g. demo_agent"
              className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-zinc-100 placeholder-zinc-700 outline-none transition-all"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-zinc-100 placeholder-zinc-700 outline-none transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center text-zinc-600 text-[10px] leading-relaxed border-t border-zinc-800/50 pt-4">
          Demo Credentials: <span className="text-zinc-500 font-semibold">demo_agent</span> / <span className="text-zinc-500 font-semibold">demo123</span>
        </div>
      </div>
    </div>
  );
}

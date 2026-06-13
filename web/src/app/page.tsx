"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [issue, setIssue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !issue.trim()) return;

    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.createSupportRequest(name.trim(), issue.trim());
      router.push(`/session/${res.session.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to submit support request');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col items-center justify-center p-4 selection:bg-indigo-500 selection:text-white relative overflow-hidden">
      {/* Background radial effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-zinc-200 to-zinc-400 flex items-center justify-center font-bold text-zinc-900 shadow-md mx-auto text-xl">
            VQ
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
            Need Help?
          </h1>
          <p className="text-sm text-zinc-400 max-w-xs mx-auto">
            Tell us what you need help with and an agent will join shortly.
          </p>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-sm space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-900/30 text-red-400 text-xs flex gap-2 items-center">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="customer-name" className="text-xs font-medium text-zinc-400">
                Name
              </label>
              <input
                id="customer-name"
                type="text"
                required
                disabled={loading}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-zinc-700 focus:ring-0 text-sm text-zinc-100 placeholder-zinc-650 transition-all outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="customer-issue" className="text-xs font-medium text-zinc-400">
                What can we help you with?
              </label>
              <textarea
                id="customer-issue"
                required
                disabled={loading}
                rows={4}
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                placeholder="Describe your issue in detail..."
                className="w-full px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-zinc-700 focus:ring-0 text-sm text-zinc-100 placeholder-zinc-650 transition-all outline-none resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !name.trim() || !issue.trim()}
              className="w-full py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 disabled:bg-zinc-800 text-zinc-900 disabled:text-zinc-500 font-medium text-sm shadow-lg shadow-black/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Submitting Request...
                </>
              ) : (
                'Request Support'
              )}
            </button>
          </form>
        </div>

        <div className="flex items-center justify-center gap-3 text-xs text-zinc-600">
          <a href="/agent" className="hover:text-zinc-400 transition-colors">
            Agent Login
          </a>
        </div>
      </div>
    </div>
  );
}

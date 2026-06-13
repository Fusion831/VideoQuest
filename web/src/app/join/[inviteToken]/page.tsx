"use client";

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface PageProps {
  params: Promise<{ inviteToken: string }>;
}

export default function CustomerJoinPage({ params }: PageProps) {
  const router = useRouter();
  const { inviteToken } = use(params);

  const [validationLoading, setValidationLoading] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [validationErrorType, setValidationErrorType] = useState<'INVALID' | 'EXPIRED' | 'ENDED' | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const validateToken = async () => {
      try {
        setValidationLoading(true);
        setValidationErrorType(null);
        setError(null);
        const res = await apiClient.validateInvite(inviteToken);
        setIsValid(res.valid);
        setSessionId(res.session_id);
        setSessionStatus(res.status);
      } catch (err: any) {
        setIsValid(false);
        const errMsg = err.message || '';
        if (errMsg.includes('ended')) {
          setValidationErrorType('ENDED');
        } else if (errMsg.includes('expired')) {
          setValidationErrorType('EXPIRED');
        } else {
          setValidationErrorType('INVALID');
        }
      } finally {
        setValidationLoading(false);
      }
    };

    if (inviteToken) {
      validateToken();
    }
  }, [inviteToken]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !customerId.trim()) return;

    try {
      setJoinLoading(true);
      setError(null);
      await apiClient.joinSession(sessionId, customerId, 'customer', inviteToken);
      
      // Store customer identity in session-specific localStorage keys
      localStorage.setItem(`vq_identity_${sessionId}_userId`, customerId);
      localStorage.setItem(`vq_identity_${sessionId}_role`, 'customer');
      
      // Navigate to the session room page
      router.push(`/session/${sessionId}?role=customer&userId=${encodeURIComponent(customerId)}`);
    } catch (err: any) {
      setError(err.message || 'Failed to join session');
    } finally {
      setJoinLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col items-center justify-center p-4 selection:bg-indigo-500 selection:text-white">
      <div className="w-full max-w-md p-8 rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-2xl shadow-black/60 relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute -top-20 -left-20 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Brand/Title */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20 mx-auto mb-4 text-xl">
            VQ
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-zinc-100 to-zinc-300 bg-clip-text text-transparent">
            Support Room Invitation
          </h1>
          <p className="text-zinc-500 text-xs mt-2">
            Secure token validation portal
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

        {validationLoading ? (
          <div className="py-8 text-center flex flex-col items-center gap-3">
            <svg className="w-8 h-8 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm text-zinc-400">Verifying secure token integrity...</span>
          </div>
        ) : validationErrorType === 'INVALID' ? (
          <div className="py-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-950/40 border border-red-900/30 flex items-center justify-center mx-auto text-red-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-300">Invalid support link</h3>
              <p className="text-xs text-zinc-500 leading-relaxed max-w-xs mx-auto">
                The support invitation code is invalid, unrecognized, or has been entered incorrectly.
              </p>
            </div>
          </div>
        ) : validationErrorType === 'EXPIRED' ? (
          <div className="py-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-950/40 border border-amber-900/30 flex items-center justify-center mx-auto text-amber-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-300">Support session unavailable</h3>
              <p className="text-xs text-zinc-500 leading-relaxed max-w-xs mx-auto">
                This support invitation link has expired. Secure invite tokens are valid for up to 24 hours.
              </p>
            </div>
          </div>
        ) : validationErrorType === 'ENDED' ? (
          <div className="py-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-zinc-950/60 border border-zinc-805/30 flex items-center justify-center mx-auto text-zinc-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-300">This support session has ended</h3>
              <p className="text-xs text-zinc-500 leading-relaxed max-w-xs mx-auto">
                The agent has completed or terminated this support session. If you still need help, please request a new invite.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleJoin} className="space-y-5">
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs space-y-2">
              <div className="flex justify-between text-zinc-500">
                <span>Room Token Status:</span>
                <span className="text-emerald-400 font-semibold">Active & Valid</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>Session Status:</span>
                <span className="text-zinc-300 font-medium">{sessionStatus}</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>Target Node ID:</span>
                <span className="font-mono text-zinc-400">{sessionId?.slice(0, 8)}...</span>
              </div>
            </div>

            <div>
              <label htmlFor="customerId" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                Your Name / Username
              </label>
              <input
                id="customerId"
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
                placeholder="Enter display name"
                className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-zinc-100 placeholder-zinc-600 outline-none transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={joinLoading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {joinLoading ? 'Entering Support Room...' : 'Join Support Session'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

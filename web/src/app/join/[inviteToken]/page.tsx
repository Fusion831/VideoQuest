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
  const [issueDescription, setIssueDescription] = useState('');
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
      localStorage.setItem(`vq_issue_${sessionId}`, issueDescription.trim());
      
      // Navigate to the session room page
      router.push(`/session/${sessionId}?role=customer&userId=${encodeURIComponent(customerId)}`);
    } catch (err: any) {
      setError(err.message || 'Failed to request support');
    } finally {
      setJoinLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col items-center justify-center p-4 sm:p-6 selection:bg-purple-600 selection:text-white relative overflow-hidden">
      {/* Background soft ambient lights */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-purple-900/5 rounded-full blur-3xl pointer-events-none" />
      
      <div className="w-full max-w-lg relative z-10 space-y-6">
        {error && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-900/30 text-red-200 text-sm flex gap-3 items-center">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>{error}</div>
          </div>
        )}

        {validationLoading ? (
          <div className="p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 backdrop-blur-sm text-center flex flex-col items-center justify-center gap-4 py-16 shadow-xl">
            <div className="relative">
              <div className="w-10 h-10 rounded-full border-2 border-zinc-800 border-t-purple-500 animate-spin" />
            </div>
            <div className="space-y-1">
              <h3 className="text-zinc-200 font-medium text-sm">Connecting to support portal...</h3>
              <p className="text-zinc-500 text-xs">Securing a connection to our support system</p>
            </div>
          </div>
        ) : validationErrorType === 'INVALID' ? (
          <div className="p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 backdrop-blur-sm text-center space-y-6 shadow-xl py-12">
            <div className="w-12 h-12 rounded-full bg-red-950/30 border border-red-900/30 flex items-center justify-center mx-auto text-red-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-zinc-200">Support link invalid</h3>
              <p className="text-zinc-400 text-sm leading-relaxed max-w-sm mx-auto">
                This invitation link appears to be invalid or formatted incorrectly. Please ask your support agent for a new invite.
              </p>
            </div>
          </div>
        ) : validationErrorType === 'EXPIRED' ? (
          <div className="p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 backdrop-blur-sm text-center space-y-6 shadow-xl py-12">
            <div className="w-12 h-12 rounded-full bg-amber-950/30 border border-amber-900/30 flex items-center justify-center mx-auto text-amber-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-zinc-200">Support link expired</h3>
              <p className="text-zinc-400 text-sm leading-relaxed max-w-sm mx-auto">
                This support session invitation is no longer active. Secure invitation links expire after 24 hours.
              </p>
            </div>
          </div>
        ) : validationErrorType === 'ENDED' ? (
          <div className="p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800/80 backdrop-blur-sm text-center space-y-6 shadow-xl py-12">
            <div className="w-12 h-12 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-zinc-200">Session completed</h3>
              <p className="text-zinc-400 text-sm leading-relaxed max-w-sm mx-auto">
                This support session has already concluded. If you still require assistance, please request a new session from our support team.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="p-8 sm:p-10 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur-md shadow-2xl relative">
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />
              
              <div className="space-y-2 mb-8 text-center sm:text-left">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
                  Need Help?
                </h1>
                <p className="text-zinc-350 font-medium text-lg">
                  Connect with a support specialist.
                </p>
                <p className="text-zinc-500 text-sm max-w-md">
                  Describe your issue and we'll connect you with an available agent.
                </p>
              </div>

              <form onSubmit={handleJoin} className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="customerId" className="block text-sm font-medium text-zinc-350">
                    Your Name
                  </label>
                  <input
                    id="customerId"
                    type="text"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    required
                    placeholder="Enter your name"
                    autoComplete="name"
                    className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-purple-500/80 focus:ring-1 focus:ring-purple-500/80 text-zinc-100 placeholder-zinc-600 outline-none transition-all text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="issue" className="block text-sm font-medium text-zinc-350">
                    What do you need help with?
                  </label>
                  <textarea
                    id="issue"
                    value={issueDescription}
                    onChange={(e) => setIssueDescription(e.target.value)}
                    required
                    rows={4}
                    placeholder="Briefly describe your request..."
                    className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-purple-500/80 focus:ring-1 focus:ring-purple-500/80 text-zinc-100 placeholder-zinc-600 outline-none transition-all text-sm resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={joinLoading}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-medium text-sm shadow-lg shadow-purple-950/20 active:scale-[0.99] transition-all cursor-pointer"
                >
                  {joinLoading ? 'Sending Request...' : 'Request Support'}
                </button>
              </form>
            </div>

            {/* How it works section */}
            <div className="p-8 rounded-2xl bg-zinc-900/30 border border-zinc-900/60 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                How it works
              </h2>
              <ol className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-zinc-400">
                <li className="flex gap-3 items-start">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center shrink-0 font-medium">1</span>
                  <span>Submit your request</span>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center shrink-0 font-medium">2</span>
                  <span>An agent reviews it</span>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center shrink-0 font-medium">3</span>
                  <span>Chat begins immediately</span>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center shrink-0 font-medium">4</span>
                  <span>Video consultation can be used if needed</span>
                </li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

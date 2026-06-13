"use client";

import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col items-center justify-center p-6 selection:bg-indigo-500 selection:text-white relative overflow-hidden">
      {/* Background radial effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-lg text-center space-y-8 relative z-10">
        <div className="space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-white shadow-xl shadow-indigo-500/30 mx-auto text-3xl">
            VQ
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-zinc-50 to-zinc-400 bg-clip-text text-transparent sm:text-5xl">
            VideoQuest Workspace
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed max-w-sm mx-auto">
            Professional support consultation portal for real-time customer engagement and remote video consultations.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md mx-auto">
          <Link
            href="/agent"
            className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700/60 shadow-lg hover:shadow-indigo-500/5 transition-all text-left flex flex-col justify-between h-36 group"
          >
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">Staff Access</span>
              <h3 className="font-bold text-lg text-zinc-100 mt-1">Agent Console</h3>
            </div>
            <span className="text-xs text-zinc-500 group-hover:text-zinc-350 transition-colors flex items-center gap-1.5">
              Launch dashboard →
            </span>
          </Link>

          <div className="p-6 rounded-2xl bg-zinc-900/40 border border-zinc-850 shadow-lg text-left flex flex-col justify-between h-36">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-650">Client Access</span>
              <h3 className="font-bold text-lg text-zinc-500 mt-1">Customer Join</h3>
            </div>
            <p className="text-[11px] text-zinc-600 leading-normal">
              Customers join dynamically using the secure invite link generated from the agent dashboard.
            </p>
          </div>
        </div>

        <div className="border-t border-zinc-900 pt-6 max-w-xs mx-auto">
          <span className="text-[10px] uppercase font-semibold tracking-widest text-zinc-650">VideoQuest Consultation Platform</span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/agent');
  }, [router]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-400 flex flex-col items-center justify-center gap-4 font-sans">
      <div className="w-8 h-8 rounded-full border-2 border-zinc-800 border-t-purple-500 animate-spin" />
      <span className="text-sm">Redirecting to workspace...</span>
    </div>
  );
}

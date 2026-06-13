"use client";

import { useEffect, useState, useRef } from 'react';
import { Room, Track, RoomEvent } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  VideoTrack,
} from '@livekit/components-react';
import { apiClient } from '@/lib/api-client';

interface MediaRoomProps {
  sessionId: string;
  userId: string;
  role: 'agent' | 'customer';
  sessionStatus: string;
}

export default function MediaRoom({ sessionId, userId, role, sessionStatus }: MediaRoomProps) {
  const [token, setToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  // 1. Hardware State Preferences with localStorage persistence
  const [isCameraPreConnected, setIsCameraPreConnected] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('vq_pref_camera') !== 'false';
  });
  const [isMicrophonePreConnected, setIsMicrophonePreConnected] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('vq_pref_mic') !== 'false';
  });

  // Local preview stream for queue mode (when sessionStatus !== 'ACTIVE')
  const [localPreviewStream, setLocalPreviewStream] = useState<MediaStream | null>(null);
  const localPreviewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Sync state changes back to localStorage
  useEffect(() => {
    localStorage.setItem('vq_pref_camera', String(isCameraPreConnected));
  }, [isCameraPreConnected]);

  useEffect(() => {
    localStorage.setItem('vq_pref_mic', String(isMicrophonePreConnected));
  }, [isMicrophonePreConnected]);

  // Log token request state
  const tokenRequestStarted = sessionStatus === 'ACTIVE';
  const tokenRequestSucceeded = !!token;

  console.log('[MediaRoom] State Audit:', {
    resolvedUserId: userId,
    resolvedRole: role,
    sessionStatus,
    mediaRoomMounted: 'YES',
    tokenRequestStarted,
    tokenRequestSucceeded,
    hasError: !!error || !!deviceError,
  });

  // 2. Hardware / Device enumeration and diagnostics check
  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.mediaDevices) return;

    async function checkDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasVideo = devices.some(d => d.kind === 'videoinput');
        const hasAudio = devices.some(d => d.kind === 'audioinput');

        if (!hasVideo && !hasAudio) {
          setDeviceError('No camera or microphone detected');
          return;
        } else if (!hasVideo) {
          setDeviceError('No camera detected');
        } else if (!hasAudio) {
          setDeviceError('No microphone detected');
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: hasVideo, audio: hasAudio });
          stream.getTracks().forEach(t => t.stop());
          setDeviceError(null);
        } catch (err: any) {
          console.warn('getUserMedia permission check failed:', err);
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            if (hasVideo && hasAudio) {
              setDeviceError('Camera or microphone permission denied');
            } else if (hasVideo) {
              setDeviceError('Camera permission denied');
            } else {
              setDeviceError('Microphone permission denied');
            }
          }
        }
      } catch (err: any) {
        console.error('Failed to enumerate devices:', err);
      }
    }

    checkDevices();
  }, [sessionStatus]);

  // 3. Local Queue Preview Stream acquisition / lifecycle management
  useEffect(() => {
    if (sessionStatus === 'ACTIVE') {
      if (localPreviewStream) {
        localPreviewStream.getTracks().forEach(t => t.stop());
        setLocalPreviewStream(null);
      }
      return;
    }

    let active = true;
    let stream: MediaStream | null = null;

    async function startPreview() {
      if (!isCameraPreConnected) {
        if (localPreviewStream) {
          localPreviewStream.getTracks().forEach(t => t.stop());
          setLocalPreviewStream(null);
        }
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false, // Avoid feedback loop
        });
        if (active) {
          setLocalPreviewStream(stream);
        } else {
          stream.getTracks().forEach(t => t.stop());
        }
      } catch (err) {
        console.warn('Queue local preview camera access failed:', err);
        if (active) {
          setLocalPreviewStream(null);
        }
      }
    }

    startPreview();

    return () => {
      active = false;
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [isCameraPreConnected, sessionStatus]);

  // Bind local preview stream to <video> element
  useEffect(() => {
    if (localPreviewVideoRef.current) {
      localPreviewVideoRef.current.srcObject = localPreviewStream;
    }
  }, [localPreviewStream]);

  // 4. Active session LiveKit token fetcher
  useEffect(() => {
    let active = true;

    async function fetchToken() {
      if (sessionStatus !== 'ACTIVE') {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        console.log('[MediaRoom] Fetching LiveKit token from backend...', { sessionId, userId, role });
        const res = await apiClient.getLiveKitToken(sessionId, userId, role);
        console.log('[MediaRoom] Token fetch succeeded:', { hasToken: !!res.token, url: res.livekit_url });
        if (active) {
          setToken(res.token);
          const publicUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7880';
          console.log('[MediaRoom] Using public LiveKit URL:', publicUrl, '(backend returned:', res.livekit_url, ')');
          setLivekitUrl(publicUrl);
        }
      } catch (err: any) {
        console.error('[MediaRoom] Token fetch failed:', err);
        if (active) {
          setError(err.message || 'Media server offline');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    fetchToken();

    return () => {
      active = false;
    };
  }, [sessionId, userId, role, sessionStatus]);

  const visualMarker = (
    <div id="media-room-marker" className="bg-zinc-950 border-b border-zinc-800 text-zinc-500 font-bold text-center py-1.5 text-[10px] uppercase tracking-wider select-none flex items-center justify-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
      LiveKit WebRTC Channel Active
    </div>
  );

  const deviceWarning = deviceError && (
    <div className="p-3 bg-red-950/60 border-b border-red-900/40 text-red-300 text-xs flex gap-2.5 items-center font-semibold">
      <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <div>
        <span>🚨 Hardware Status: {deviceError}</span>
        <span className="block text-[10px] text-zinc-400 font-normal mt-0.5">The application remains fully usable. You can still use chat and see others.</span>
      </div>
    </div>
  );

  // 5. Render Local Queue Preview Mode if not active
  if (sessionStatus !== 'ACTIVE') {
    const expectedRemoteRole = role === 'agent' ? 'customer' : 'agent';
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden shadow-xl shadow-black/40 flex flex-col" style={{ minHeight: '380px' }}>
        {visualMarker}
        {deviceWarning}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 min-h-[300px] bg-zinc-950/40">
          
          {/* Local Participant Preview Tile */}
          <div className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            {isCameraPreConnected && localPreviewStream ? (
              <div className="w-full h-full relative">
                <video
                  ref={localPreviewVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-zinc-500 bg-zinc-950/60 w-full h-full select-none">
                <svg className="w-12 h-12 mb-2 text-zinc-750" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">🔴 Camera Off</span>
              </div>
            )}

            {/* Local Queue Status overlay */}
            <div className="absolute top-3 left-3 bg-zinc-950/90 border border-zinc-800/80 rounded-lg p-2.5 text-[10px] text-zinc-300 space-y-1.5 backdrop-blur-sm shadow-xl min-w-[120px] z-10 select-none">
              <div className="font-bold text-indigo-400 uppercase tracking-wider border-b border-zinc-800/50 pb-0.5">You ({role})</div>
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-zinc-500">Camera:</span>
                <span className={`font-semibold ${isCameraPreConnected ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isCameraPreConnected ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-zinc-500">Microphone:</span>
                <span className={`font-semibold ${isMicrophonePreConnected ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isMicrophonePreConnected ? 'ON' : 'MUTED'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-zinc-500">Status:</span>
                <span className="text-amber-400 font-semibold uppercase">QUEUED</span>
              </div>
            </div>
          </div>

          {/* Remote Participant Queue Tile */}
          <div className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <div className="flex flex-col items-center justify-center text-zinc-500 text-center px-4 bg-zinc-950/20 w-full h-full select-none">
              <svg className="w-8 h-8 mb-2 animate-pulse text-zinc-650" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 block mb-1">
                Waiting for {expectedRemoteRole} to join...
              </span>
              <span className="text-[9px] text-zinc-600 leading-relaxed max-w-[210px]">
                Media is in queue setup. Grant permissions and turn on your camera. Streaming begins automatically.
              </span>
            </div>

            {/* Remote Status Overlay */}
            <div className="absolute top-3 left-3 bg-zinc-950/90 border border-zinc-800/80 rounded-lg p-2.5 text-[10px] text-zinc-300 space-y-1.5 backdrop-blur-sm shadow-xl min-w-[120px] z-10 select-none">
              <div className="font-bold text-violet-400 uppercase tracking-wider border-b border-zinc-800/50 pb-0.5">
                {expectedRemoteRole}
              </div>
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-zinc-500">Camera:</span>
                <span className="text-zinc-600 font-semibold">PENDING</span>
              </div>
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-zinc-500">Microphone:</span>
                <span className="text-zinc-600 font-semibold">PENDING</span>
              </div>
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-zinc-500">Status:</span>
                <span className="text-zinc-600 font-semibold uppercase">OFFLINE</span>
              </div>
            </div>
          </div>
        </div>

        {/* Queue Control Panel */}
        <div className="h-14 bg-zinc-900 border-t border-zinc-850 px-4 flex items-center justify-between min-h-[56px] shrink-0 select-none">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">
              🟡 Waiting in Queue (Session status: {sessionStatus})
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMicrophonePreConnected(!isMicrophonePreConnected)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all active:scale-95 ${
                isMicrophonePreConnected
                  ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                  : 'bg-red-950/40 border-red-900/30 text-red-400 hover:bg-red-900/20'
              }`}
            >
              {isMicrophonePreConnected ? '🟢 Mic On' : '🔴 Mic Muted'}
            </button>
            <button
              onClick={() => setIsCameraPreConnected(!isCameraPreConnected)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all active:scale-95 ${
                isCameraPreConnected
                  ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                  : 'bg-red-950/40 border-red-900/30 text-red-400 hover:bg-red-900/20'
              }`}
            >
              {isCameraPreConnected ? '🟢 Camera On' : '🔴 Camera Off'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl overflow-hidden border border-zinc-800">
        {visualMarker}
        {deviceWarning}
        <div className="p-12 bg-zinc-900 flex flex-col items-center justify-center gap-3">
          <svg className="w-6 h-6 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-xs text-zinc-400">Requesting media credentials...</span>
        </div>
      </div>
    );
  }

  if (error || !token || !livekitUrl) {
    return (
      <div className="rounded-2xl overflow-hidden border border-amber-900/30">
        {visualMarker}
        {deviceWarning}
        <div className="p-6 bg-amber-950/20 text-amber-200 text-xs">
          <div className="flex items-center gap-3 mb-2 font-semibold">
            <svg className="w-5 h-5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Video service offline — operating in text-only mode.</span>
          </div>
          <p className="text-zinc-400 leading-relaxed">
            The support session is fully active, and presence/chat are functional. However, the media server is currently unreachable.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden shadow-xl shadow-black/40 flex flex-col" style={{ minHeight: '380px' }}>
      {visualMarker}
      {deviceWarning}
      <LiveKitRoom
        video={isCameraPreConnected}
        audio={isMicrophonePreConnected}
        token={token}
        serverUrl={livekitUrl}
        connect={true}
        data-lk-theme="default"
        className="flex-1 flex flex-col min-h-0"
      >
        <MediaGrid
          role={role}
          isCameraPreConnected={isCameraPreConnected}
          isMicrophonePreConnected={isMicrophonePreConnected}
          setIsCameraPreConnected={setIsCameraPreConnected}
          setIsMicrophonePreConnected={setIsMicrophonePreConnected}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}

function getConnectionLabel(state: string) {
  switch (state) {
    case 'connected':
      return { label: 'Media Connected', color: 'bg-emerald-500', emoji: '🟢' };
    case 'connecting':
      return { label: 'Connecting', color: 'bg-amber-500 animate-pulse', emoji: '🟡' };
    case 'reconnecting':
      return { label: 'Reconnecting', color: 'bg-amber-500 animate-pulse', emoji: '🟡' };
    case 'disconnected':
    default:
      return { label: 'Media Offline', color: 'bg-red-500', emoji: '🔴' };
  }
}

function MediaGrid({
  role,
  isCameraPreConnected,
  isMicrophonePreConnected,
  setIsCameraPreConnected,
  setIsMicrophonePreConnected,
}: {
  role: 'agent' | 'customer';
  isCameraPreConnected: boolean;
  isMicrophonePreConnected: boolean;
  setIsCameraPreConnected: (val: boolean) => void;
  setIsMicrophonePreConnected: (val: boolean) => void;
}) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const { isCameraEnabled, isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const room = useRoomContext();
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const remoteParticipant = participants.find((p) => p.sid !== localParticipant?.sid);
  const expectedRemoteRole = role === 'agent' ? 'customer' : 'agent';

  // 6. Track Publication Verification (Derived directly from LiveKit state)
  const localVideoPub = localParticipant ? localParticipant.getTrackPublication(Track.Source.Camera) : null;
  const localAudioPub = localParticipant ? localParticipant.getTrackPublication(Track.Source.Microphone) : null;
  const isLocalVideoPublished = !!localVideoPub && !localVideoPub.isMuted;
  const isLocalAudioPublished = !!localAudioPub && !localAudioPub.isMuted;

  const remoteVideoPub = remoteParticipant ? remoteParticipant.getTrackPublication(Track.Source.Camera) : null;
  const remoteAudioPub = remoteParticipant ? remoteParticipant.getTrackPublication(Track.Source.Microphone) : null;
  const isRemoteVideoPublished = !!remoteVideoPub && !!remoteVideoPub.track && !remoteVideoPub.isMuted;
  const isRemoteAudioPublished = !!remoteAudioPub && !!remoteAudioPub.track && !remoteAudioPub.isMuted;

  // 8. Connection state mapping
  const connState = room?.state || 'disconnected';
  const conn = getConnectionLabel(connState);

  // Local/Remote Video TrackReferences
  const localVideoTrackRef = tracks.find(
    (t) => t.participant.sid === localParticipant?.sid && t.source === Track.Source.Camera
  ) as any;
  const remoteVideoTrackRef = remoteParticipant
    ? (tracks.find((t) => t.participant.sid === remoteParticipant.sid && t.source === Track.Source.Camera) as any)
    : null;

  const handleToggleMute = () => {
    const nextVal = !isMicrophoneEnabled;
    localParticipant?.setMicrophoneEnabled(nextVal);
    setIsMicrophonePreConnected(nextVal);
  };

  const handleToggleCamera = () => {
    const nextVal = !isCameraEnabled;
    localParticipant?.setCameraEnabled(nextVal);
    setIsCameraPreConnected(nextVal);
  };

  const handleLeaveCall = () => {
    room?.disconnect();
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-zinc-905">
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 min-h-[300px] bg-zinc-950/40">
        
        {/* 1. Local Participant Tile (Always Visible) */}
        <div className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center">
          {isCameraEnabled && localVideoTrackRef ? (
            <div className="w-full h-full [&>video]:object-cover relative">
              <VideoTrack trackRef={localVideoTrackRef} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-zinc-500 bg-zinc-950/60 w-full h-full select-none">
              <svg className="w-12 h-12 mb-2 text-zinc-750" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">🔴 Camera Off</span>
            </div>
          )}

          {/* 4. Participant Media Status Overlay (Local) */}
          <div className="absolute top-3 left-3 bg-zinc-950/90 border border-zinc-800/80 rounded-lg p-2.5 text-[10px] text-zinc-300 space-y-1.5 backdrop-blur-sm shadow-xl min-w-[120px] z-10 select-none">
            <div className="font-bold text-indigo-400 uppercase tracking-wider border-b border-zinc-800/50 pb-0.5">You ({role})</div>
            <div className="flex items-center justify-between gap-2.5">
              <span className="text-zinc-500">Camera:</span>
              <span className={`font-semibold ${isCameraEnabled && isLocalVideoPublished ? 'text-emerald-400' : 'text-red-400'}`}>
                {isCameraEnabled && isLocalVideoPublished ? 'ON' : 'OFF'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2.5">
              <span className="text-zinc-500">Microphone:</span>
              <span className={`font-semibold ${isMicrophoneEnabled && isLocalAudioPublished ? 'text-emerald-400' : 'text-red-400'}`}>
                {isMicrophoneEnabled && isLocalAudioPublished ? 'ON' : 'MUTED'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2.5">
              <span className="text-zinc-500">Status:</span>
              <span className="text-emerald-400 font-semibold">CONNECTED</span>
            </div>
          </div>
        </div>

        {/* Remote Participant Tile */}
        <div className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center">
          {remoteParticipant ? (
            remoteParticipant.isCameraEnabled && remoteVideoTrackRef ? (
              <div className="w-full h-full [&>video]:object-cover relative">
                <VideoTrack trackRef={remoteVideoTrackRef} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-zinc-500 bg-zinc-950/60 w-full h-full select-none">
                <svg className="w-12 h-12 mb-2 text-zinc-750" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">🔴 Camera Off</span>
              </div>
            )
          ) : (
            /* 5. Remote Participant Waiting State */
            <div className="flex flex-col items-center justify-center text-zinc-500 text-center px-4 bg-zinc-950/20 w-full h-full select-none">
              <svg className="w-8 h-8 mb-2 animate-pulse text-indigo-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 block mb-1">
                Waiting for {expectedRemoteRole} to join...
              </span>
              <span className="text-[9px] text-zinc-650 leading-relaxed max-w-[210px]">
                Waiting for the other participant to establish a media link.
              </span>
            </div>
          )}

          {/* 4. Participant Media Status Overlay (Remote) */}
          {remoteParticipant && (
            <div className="absolute top-3 left-3 bg-zinc-950/90 border border-zinc-800/80 rounded-lg p-2.5 text-[10px] text-zinc-300 space-y-1.5 backdrop-blur-sm shadow-xl min-w-[120px] z-10 select-none">
              <div className="font-bold text-violet-400 uppercase tracking-wider border-b border-zinc-800/50 pb-0.5">
                {remoteParticipant.identity.split('_')[0] || 'User'} ({expectedRemoteRole})
              </div>
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-zinc-500">Camera:</span>
                <span className={`font-semibold ${remoteParticipant.isCameraEnabled && isRemoteVideoPublished ? 'text-emerald-400' : 'text-red-400'}`}>
                  {remoteParticipant.isCameraEnabled && isRemoteVideoPublished ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-zinc-500">Microphone:</span>
                <span className={`font-semibold ${remoteParticipant.isMicrophoneEnabled && isRemoteAudioPublished ? 'text-emerald-400' : 'text-red-400'}`}>
                  {remoteParticipant.isMicrophoneEnabled && isRemoteAudioPublished ? 'ON' : 'MUTED'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-zinc-500">Status:</span>
                <span className="text-emerald-400 font-semibold">CONNECTED</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Control Panel / Connection Status Bar */}
      <div className="h-14 bg-zinc-900 border-t border-zinc-850 px-4 flex items-center justify-between min-h-[56px] shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${conn.color}`} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            {conn.emoji} {conn.label}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-bold uppercase text-zinc-400 hover:text-zinc-200 transition-all active:scale-95"
            title="Show system connections metadata"
          >
            🛠 Diagnostics
          </button>
          
          <button
            onClick={handleToggleMute}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all active:scale-95 ${
              isMicrophoneEnabled
                ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                : 'bg-red-950/40 border-red-900/30 text-red-400 hover:bg-red-900/20'
            }`}
          >
            {isMicrophoneEnabled ? '🟢 Mic On' : '🔴 Mic Muted'}
          </button>
          <button
            onClick={handleToggleCamera}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all active:scale-95 ${
              isCameraEnabled
                ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                : 'bg-red-950/40 border-red-900/30 text-red-400 hover:bg-red-900/20'
            }`}
          >
            {isCameraEnabled ? '🟢 Camera On' : '🔴 Camera Off'}
          </button>
          <button
            onClick={handleLeaveCall}
            className="px-3 py-1.5 rounded-lg bg-red-950/50 hover:bg-red-900/30 text-red-400 border border-red-900/30 text-xs font-semibold transition-all active:scale-95"
          >
            Leave Call
          </button>
        </div>
      </div>

      {/* 9. Connection Diagnostics Panel */}
      {showDiagnostics && (
        <div className="p-4 bg-zinc-950 border-t border-zinc-850 font-mono text-[9px] text-zinc-400 space-y-2 select-none overflow-y-auto max-h-[140px] shrink-0">
          <div className="font-bold text-zinc-500 uppercase tracking-wider pb-1 border-b border-zinc-900 flex justify-between">
            <span>Room Diagnostics Panel</span>
            <span className="text-indigo-400">DEV MODE ACTIVE</span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div><span className="text-zinc-650">Room Name:</span> {room?.name || 'N/A'}</div>
            <div><span className="text-zinc-650">Connection State:</span> {connState.toUpperCase()}</div>
            <div><span className="text-zinc-650">Identity:</span> {localParticipant?.identity || 'N/A'}</div>
            <div><span className="text-zinc-650">Sid:</span> {localParticipant?.sid || 'N/A'}</div>
            <div><span className="text-zinc-650">Published Video:</span> {isLocalVideoPublished ? '🟢 Active' : '🔴 Muted/Inactive'}</div>
            <div><span className="text-zinc-650">Published Audio:</span> {isLocalAudioPublished ? '🟢 Active' : '🔴 Muted/Inactive'}</div>
            <div><span className="text-zinc-650">Video Track:</span> {localVideoPub?.trackSid || 'None'}</div>
            <div><span className="text-zinc-650">Audio Track:</span> {localAudioPub?.trackSid || 'None'}</div>
          </div>
          <div className="pt-2 border-t border-zinc-900">
            <div className="text-zinc-500 font-bold mb-1">Subscribed Remote Tracks:</div>
            {participants.filter(p => p.sid !== localParticipant?.sid).map(p => {
              const videoTracks = Array.from(p.videoTrackPublications.values() as any) as any[];
              const audioTracks = Array.from(p.audioTrackPublications.values() as any) as any[];
              return (
                <div key={p.sid} className="space-y-0.5">
                  <div className="text-zinc-300 font-semibold">{p.identity} ({p.sid}):</div>
                  <div className="pl-3 text-zinc-500">
                    - Video: {videoTracks.map(t => `${t.trackSid} (Subscribed: ${t.isSubscribed ? 'Yes' : 'No'}, Muted: ${t.isMuted ? 'Yes' : 'No'})`).join(', ') || 'None'}
                  </div>
                  <div className="pl-3 text-zinc-500">
                    - Audio: {audioTracks.map(t => `${t.trackSid} (Subscribed: ${t.isSubscribed ? 'Yes' : 'No'}, Muted: ${t.isMuted ? 'Yes' : 'No'})`).join(', ') || 'None'}
                  </div>
                </div>
              );
            })}
            {participants.length <= 1 && <div className="text-zinc-605 italic">No remote participants subscribed.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

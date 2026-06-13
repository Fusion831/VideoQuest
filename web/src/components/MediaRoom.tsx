"use client";

import { useEffect, useState, useRef } from 'react';
import { Room, Track, RoomEvent, VideoPresets } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  VideoTrack,
  useConnectionState,
} from '@livekit/components-react';
import { apiClient } from '@/lib/api-client';

interface MediaRoomProps {
  sessionId: string;
  userId: string;
  role: 'agent' | 'customer';
  sessionStatus: string;
}

const ROOM_OPTIONS = {
  adaptiveStream: false,
  dynacast: false,
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
  },
  publishDefaults: {
    simulcast: false,
    videoCodec: 'vp8' as const,
    videoEncoding: VideoPresets.h720.encoding,
  }
};

export default function MediaRoom({ sessionId, userId, role, sessionStatus }: MediaRoomProps) {
  const recordTiming = (event: string) => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    if (!w.__media_timing) w.__media_timing = {};
    if (!w.__media_timing[event]) {
      w.__media_timing[event] = performance.now();
      console.log(`[Media Lifecycle] ${event} at ${w.__media_timing[event].toFixed(2)}ms`);
      
      if (event === 'remote_video_rendered') {
        const t = w.__media_timing;
        const joinClicked = t.join_clicked || w.__join_clicked || t.get_user_media_start;
        console.log('--- MEDIA LIFECYCLE TIMING BREAKDOWN ---');
        console.log(`1. Join to GetUserMedia Start: ${(t.get_user_media_start - joinClicked).toFixed(2)}ms`);
        console.log(`2. GetUserMedia Duration: ${(t.get_user_media_success - t.get_user_media_start).toFixed(2)}ms`);
        console.log(`3. Token Request Start: ${(t.livekit_token_requested - t.get_user_media_success).toFixed(2)}ms`);
        console.log(`4. Token Fetch Duration: ${(t.livekit_token_received - t.livekit_token_requested).toFixed(2)}ms`);
        console.log(`5. Connect Called: ${(t.livekit_connect_called - t.livekit_token_received).toFixed(2)}ms`);
        console.log(`6. Room Connection Duration: ${(t.room_connected - t.livekit_connect_called).toFixed(2)}ms`);
        console.log(`7. Local Track Publish Delay: ${(t.local_track_published - t.room_connected).toFixed(2)}ms`);
        console.log(`8. Local Video Rendered: ${(t.local_video_rendered - t.local_track_published).toFixed(2)}ms`);
        console.log(`9. Remote Participant Discovered: ${(t.remote_participant_discovered - t.room_connected).toFixed(2)}ms`);
        console.log(`10. Remote Track Subscribed: ${(t.remote_track_subscribed - t.remote_participant_discovered).toFixed(2)}ms`);
        console.log(`11. Remote Video Rendered: ${(t.remote_video_rendered - t.remote_track_subscribed).toFixed(2)}ms`);
        console.log(`Total Time to Remote Video: ${(t.remote_video_rendered - joinClicked).toFixed(2)}ms`);
        console.log('----------------------------------------');
      }
    }
  };

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

  // Unified device error handler mapping specific browser/OS exceptions
  const handleDeviceError = (err: any, deviceType: 'camera' | 'microphone' | 'both') => {
    console.warn(`[DeviceError] ${deviceType} error:`, err);
    let msg = '';
    const name = err.name || '';
    
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      msg = `Grant ${deviceType === 'both' ? 'camera/microphone' : deviceType === 'camera' ? 'camera' : 'microphone'} permission and retry.`;
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      msg = `No ${deviceType === 'both' ? 'camera/microphone' : deviceType === 'camera' ? 'camera' : 'microphone'} detected. Verify connection and retry.`;
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      msg = `${deviceType === 'both' ? 'Camera/microphone' : deviceType === 'camera' ? 'Camera' : 'Microphone'} in use by another app. Close other apps and retry.`;
    } else if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      msg = `Hardware constraints not met. Try standard quality mode.`;
    } else {
      msg = `Camera/Mic unavailable. Please check browser permissions and click retry.`;
    }
    setDeviceError(msg);
  };

  // Explicit device permission request calls
  const requestCameraPermission = async () => {
    try {
      setDeviceError(null);
      if (typeof window !== 'undefined' && !navigator.mediaDevices) {
        setDeviceError('Camera/Mic blocked: Browser requires HTTPS to access media on an IP address');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
      setIsCameraPreConnected(true);
      // Restart local preview
      if (sessionStatus !== 'ACTIVE') {
        const previewStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 485 },
          audio: false,
        });
        setLocalPreviewStream(previewStream);
      }
    } catch (err: any) {
      handleDeviceError(err, 'camera');
    }
  };

  const requestMicrophonePermission = async () => {
    try {
      setDeviceError(null);
      if (typeof window !== 'undefined' && !navigator.mediaDevices) {
        setDeviceError('Camera/Mic blocked: Browser requires HTTPS to access media on an IP address');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setIsMicrophonePreConnected(true);
    } catch (err: any) {
      handleDeviceError(err, 'microphone');
    }
  };

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
    if (typeof window === 'undefined') return;

    if (!navigator.mediaDevices) {
      setDeviceError('Camera access requires HTTPS on mobile devices. For local Wi-Fi testing, configure chrome://flags/#unsafely-treat-insecure-origin-as-secure or use a secure proxy.');
      return;
    }

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
          recordTiming('get_user_media_start');
          const stream = await navigator.mediaDevices.getUserMedia({ video: hasVideo, audio: hasAudio });
          recordTiming('get_user_media_success');
          // Important: Stop the tracks immediately. We just wanted to trigger the permission prompt
          stream.getTracks().forEach(track => track.stop());
          setDeviceError(null);
        } catch (err: any) {
          handleDeviceError(err, hasVideo && hasAudio ? 'both' : hasVideo ? 'camera' : 'microphone');
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

      if (typeof window !== 'undefined' && !navigator.mediaDevices) {
        setLocalPreviewStream(null);
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
      if (sessionStatus !== 'ACTIVE' && sessionStatus !== 'ABANDONED') {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        console.log('[MediaRoom] Fetching LiveKit token from backend...', { sessionId, userId, role });
        recordTiming('livekit_token_requested');
        const res = await apiClient.getLiveKitToken(sessionId, userId, role);
        recordTiming('livekit_token_received');
        console.log('[MediaRoom] Token fetch succeeded:', { hasToken: !!res.token, url: res.livekit_url });
        if (active) {
          setToken(res.token);
          const rawUrl = res.livekit_url || process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7880';
          let resolvedUrl = rawUrl;
          if (typeof window !== 'undefined') {
            const hostname = window.location.hostname;
            if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
              resolvedUrl = rawUrl.replace(/localhost|127\.0\.0\.1/g, hostname);
            }
          }
          console.log('[MediaRoom] Using resolved LiveKit URL:', resolvedUrl, '(raw URL:', rawUrl, ')');
          setLivekitUrl(resolvedUrl);
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

  const handleReconnectMedia = async () => {
    try {
      setError(null);
      setToken(null);
      setLoading(true);
      console.log('[MediaRoom] Manual reconnect triggered. Re-fetching token...');
      const res = await apiClient.getLiveKitToken(sessionId, userId, role);
      setToken(res.token);
      const publicUrl = res.livekit_url || process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7880';
      let resolvedUrl = publicUrl;
      if (typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
          resolvedUrl = publicUrl.replace(/localhost|127\.0\.0\.1/g, hostname);
        }
      }
      setLivekitUrl(resolvedUrl);
    } catch (err: any) {
      console.error('[MediaRoom] Manual reconnect failed:', err);
      setError(err.message || 'Media server offline');
    } finally {
      setLoading(false);
    }
  };

  const visualMarker = (
    <div id="media-room-marker" className="bg-zinc-950 border-b border-zinc-800 text-zinc-500 font-bold text-center py-1.5 text-[10px] uppercase tracking-wider select-none flex items-center justify-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
      LiveKit WebRTC Channel Active
    </div>
  );

  const deviceWarning = deviceError && (
    <div className="p-3 bg-red-950/60 border-b border-red-900/40 text-red-300 text-xs flex flex-col sm:flex-row gap-3 sm:items-center justify-between font-semibold">
      <div className="flex gap-2.5 items-center">
        <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <span>🚨 Hardware Status: {deviceError}</span>
          <span className="block text-[10px] text-zinc-400 font-normal mt-0.5">The application remains fully usable. You can still use chat and see others.</span>
        </div>
      </div>
      <div className="flex gap-2 shrink-0 flex-wrap">
        <button
          onClick={requestCameraPermission}
          className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95"
        >
          Retry Camera
        </button>
        <button
          onClick={requestMicrophonePermission}
          className="px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95"
        >
          Retry Mic
        </button>
        <button
          onClick={handleReconnectMedia}
          className="px-2.5 py-1 rounded bg-zinc-700 hover:bg-zinc-650 text-white text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95"
        >
          Retry Media
        </button>
      </div>
    </div>
  );

  // Render Session Ended View if ENDED
  if (sessionStatus === 'ENDED') {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden shadow-xl shadow-black/40 flex flex-col p-6 items-center justify-center text-center" style={{ minHeight: '380px' }}>
        <svg className="w-10 h-10 text-zinc-650 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Session Ended</span>
        <span className="text-[10px] text-zinc-500 max-w-[240px] mt-1 select-none">
          This call has concluded. You can safely close this window.
        </span>
      </div>
    );
  }

  // 5. Render Local Queue Preview Mode if CREATED
  if (sessionStatus === 'CREATED') {
    const expectedRemoteRole = role === 'agent' ? 'Customer' : 'Support Agent';
    const currentRoleLabel = role === 'agent' ? 'Support Agent' : 'Customer';
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
              <div className="font-bold text-indigo-400 uppercase tracking-wider border-b border-zinc-800/50 pb-0.5">You ({currentRoleLabel})</div>
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
        <div className="p-6 bg-amber-950/20 text-amber-200 text-xs space-y-4">
          <div className="flex items-center gap-3 font-semibold">
            <svg className="w-5 h-5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Video service offline — operating in text-only mode.</span>
          </div>
          <p className="text-zinc-400 leading-relaxed">
            The support session is fully active, and presence/chat are functional. However, the media server is currently unreachable.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleReconnectMedia}
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95"
            >
              Reconnect Media
            </button>
          </div>
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
        options={ROOM_OPTIONS}
        data-lk-theme="default"
        className="flex-1 flex flex-col min-h-0"
      >
        <MediaGrid
          role={role}
          isCameraPreConnected={isCameraPreConnected}
          isMicrophonePreConnected={isMicrophonePreConnected}
          setIsCameraPreConnected={setIsCameraPreConnected}
          setIsMicrophonePreConnected={setIsMicrophonePreConnected}
          handleReconnectMedia={handleReconnectMedia}
          onConnected={() => {}}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}

function getConnectionLabel(state: string) {
  switch (state.toUpperCase()) {
    case 'CONNECTED':
      return { label: 'Media Connected', color: 'bg-emerald-500', emoji: '🟢' };
    case 'CONNECTING':
      return { label: 'Connecting', color: 'bg-amber-500 animate-pulse', emoji: '🟡' };
    case 'RECONNECTING':
      return { label: 'Reconnecting', color: 'bg-amber-500 animate-pulse', emoji: '🟡' };
    case 'FAILED':
      return { label: 'Connection Failed', color: 'bg-red-500 animate-pulse', emoji: '❌' };
    case 'DISCONNECTED':
    default:
      return { label: 'Media Offline', color: 'bg-red-500', emoji: '🔴' };
  }
}

function LocalVideoTileDiagnostic({
  identity,
  sid,
  trackSid,
  isPublished,
}: {
  identity: string;
  sid: string;
  trackSid: string;
  isPublished: boolean;
}) {
  useEffect(() => {
    console.log('[LocalVideoTileDiagnostic] MOUNTED:', { identity, sid, trackSid, isPublished });
    return () => {
      console.log('[LocalVideoTileDiagnostic] UNMOUNTED:', { identity, sid, trackSid, isPublished });
    };
  }, []);

  useEffect(() => {
    console.log('[LocalVideoTileDiagnostic] UPDATED state:', { identity, sid, trackSid, isPublished });
  }, [identity, sid, trackSid, isPublished]);

  return null;
}

function MediaGrid({
  role,
  isCameraPreConnected,
  isMicrophonePreConnected,
  setIsCameraPreConnected,
  setIsMicrophonePreConnected,
  handleReconnectMedia,
  onConnected,
}: {
  role: 'agent' | 'customer';
  isCameraPreConnected: boolean;
  isMicrophonePreConnected: boolean;
  setIsCameraPreConnected: (val: boolean) => void;
  setIsMicrophonePreConnected: (val: boolean) => void;
  handleReconnectMedia: () => Promise<void>;
  onConnected: () => void;
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

  const remoteParticipant = participants.find((p) => p.identity !== localParticipant?.identity);
  const expectedRemoteRole = role === 'agent' ? 'Customer' : 'Support Agent';

  // 1. Connection Status derived directly from LiveKit SDK context
  const rawConnectionStatus = useConnectionState();
  const connectionStatus = (rawConnectionStatus === 'connected' ? 'CONNECTED' :
                            rawConnectionStatus === 'connecting' ? 'CONNECTING' :
                            rawConnectionStatus === 'reconnecting' ? 'RECONNECTING' :
                            'DISCONNECTED');

  // 2. Local UI Target States for lag-free visual response
  const [localCameraActive, setLocalCameraActive] = useState(isCameraPreConnected);
  const [localMicActive, setLocalMicActive] = useState(isMicrophonePreConnected);

  // 3. Control locks during active WebRTC negotiations
  const [cameraSyncing, setCameraSyncing] = useState(false);
  const [micSyncing, setMicSyncing] = useState(false);

  useEffect(() => {
    if (rawConnectionStatus === 'connected') {
      const w = window as any;
      if (w.__media_timing && !w.__media_timing['room_connected']) {
        w.__media_timing['room_connected'] = performance.now();
        console.log(`[Media Lifecycle] room_connected at ${w.__media_timing['room_connected'].toFixed(2)}ms`);
      }
      onConnected();
    } else if (rawConnectionStatus === 'connecting') {
      const w = window as any;
      if (w.__media_timing && !w.__media_timing['livekit_connect_called']) {
        w.__media_timing['livekit_connect_called'] = performance.now();
        console.log(`[Media Lifecycle] livekit_connect_called at ${w.__media_timing['livekit_connect_called'].toFixed(2)}ms`);
      }
    }
  }, [rawConnectionStatus, onConnected]);

  // Lifecycle Timing Trackers
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    if (!w.__media_timing) w.__media_timing = {};
    const t = w.__media_timing;
    
    const record = (event: string) => {
      if (!t[event]) {
        t[event] = performance.now();
        console.log(`[Media Lifecycle] ${event} at ${t[event].toFixed(2)}ms`);
        
        if (event === 'remote_video_rendered') {
          const joinClicked = t.join_clicked || w.__join_clicked || t.get_user_media_start || 0;
          console.log('--- MEDIA LIFECYCLE TIMING BREAKDOWN ---');
          console.log(`1. Join to GetUserMedia Start: ${(t.get_user_media_start - joinClicked).toFixed(2)}ms`);
          console.log(`2. GetUserMedia Duration: ${(t.get_user_media_success - t.get_user_media_start).toFixed(2)}ms`);
          console.log(`3. Token Request Start: ${(t.livekit_token_requested - t.get_user_media_success).toFixed(2)}ms`);
          console.log(`4. Token Fetch Duration: ${(t.livekit_token_received - t.livekit_token_requested).toFixed(2)}ms`);
          console.log(`5. Connect Called: ${(t.livekit_connect_called - t.livekit_token_received).toFixed(2)}ms`);
          console.log(`6. Room Connection Duration: ${(t.room_connected - t.livekit_connect_called).toFixed(2)}ms`);
          console.log(`7. Local Track Publish Delay: ${(t.local_track_published - t.room_connected).toFixed(2)}ms`);
          console.log(`8. Local Video Rendered: ${(t.local_video_rendered - t.local_track_published).toFixed(2)}ms`);
          console.log(`9. Remote Participant Discovered: ${(t.remote_participant_discovered - t.room_connected).toFixed(2)}ms`);
          console.log(`10. Remote Track Subscribed: ${(t.remote_track_subscribed - t.remote_participant_discovered).toFixed(2)}ms`);
          console.log(`11. Remote Video Rendered: ${(t.remote_video_rendered - t.remote_track_subscribed).toFixed(2)}ms`);
          console.log(`Total Time to Remote Video: ${(t.remote_video_rendered - joinClicked).toFixed(2)}ms`);
          console.log('----------------------------------------');
        }
      }
    };

    if (localParticipant.isCameraEnabled) record('local_track_published');
    if (tracks.some(tr => tr.participant.identity === localParticipant.identity && tr.source === Track.Source.Camera)) {
      record('local_video_rendered');
    }
    
    if (remoteParticipant) {
      record('remote_participant_discovered');
      if (remoteParticipant.getTrackPublications().some(p => p.kind === 'video' && p.isSubscribed)) {
        record('remote_track_subscribed');
      }
      if (tracks.some(tr => tr.participant.identity === remoteParticipant.identity && tr.source === Track.Source.Camera)) {
        record('remote_video_rendered');
      }
    }
  }, [localParticipant.isCameraEnabled, remoteParticipant, tracks]);

  // LiveKit Diagnostic Event Listeners
  useEffect(() => {
    if (!room) return;

    const logEvent = (eventName: string, ...args: any[]) => {
      console.log(`[LK-DIAG] Event: ${eventName}`, args.map(arg => {
        if (!arg) return arg;
        if (typeof arg === 'string') return arg;
        if (typeof arg === 'object') {
          return {
            identity: arg.identity || arg.participant?.identity,
            sid: arg.sid || arg.trackSid || arg.track?.sid,
            source: arg.source,
            isMuted: arg.isMuted,
            isSubscribed: arg.isSubscribed,
          };
        }
        return arg;
      }));
    };

    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
    ];

    events.forEach(evt => {
      room.on(evt, (...args: any[]) => logEvent(evt, ...args));
    });

    return () => {
      events.forEach(evt => {
        room.off(evt, (...args: any[]) => logEvent(evt, ...args));
      });
    };
  }, [room]);

  // Sync state if props change from outside
  useEffect(() => {
    setLocalCameraActive(isCameraPreConnected);
  }, [isCameraPreConnected]);

  useEffect(() => {
    setLocalMicActive(isMicrophonePreConnected);
  }, [isMicrophonePreConnected]);

  // Synchronize target camera state to LiveKit in background
  useEffect(() => {
    if (!localParticipant) return;
    let active = true;

    async function syncCamera() {
      if (localParticipant.isCameraEnabled !== localCameraActive && !cameraSyncing) {
        setCameraSyncing(true);
        try {
          console.log(`[MediaGrid] Syncing camera state to: ${localCameraActive}`);
          await localParticipant.setCameraEnabled(localCameraActive);
          setIsCameraPreConnected(localCameraActive);
        } catch (err) {
          console.error("Failed to sync camera to LiveKit:", err);
          if (active) {
            setLocalCameraActive(localParticipant.isCameraEnabled);
            setIsCameraPreConnected(localParticipant.isCameraEnabled);
          }
        } finally {
          if (active) setCameraSyncing(false);
        }
      }
    }

    syncCamera();
    return () => { active = false; };
  }, [localCameraActive, localParticipant, cameraSyncing]);

  // Synchronize target microphone state to LiveKit in background
  useEffect(() => {
    if (!localParticipant) return;
    let active = true;

    async function syncMic() {
      if (localParticipant.isMicrophoneEnabled !== localMicActive && !micSyncing) {
        setMicSyncing(true);
        try {
          console.log(`[MediaGrid] Syncing microphone state to: ${localMicActive}`);
          await localParticipant.setMicrophoneEnabled(localMicActive);
          setIsMicrophonePreConnected(localMicActive);
        } catch (err) {
          console.error("Failed to sync microphone to LiveKit:", err);
          if (active) {
            setLocalMicActive(localParticipant.isMicrophoneEnabled);
            setIsMicrophonePreConnected(localParticipant.isMicrophoneEnabled);
          }
        } finally {
          if (active) setMicSyncing(false);
        }
      }
    }

    syncMic();
    return () => { active = false; };
  }, [localMicActive, localParticipant, micSyncing]);

  // 6. Track Publication Verification (Derived directly from LiveKit state)
  const localVideoPub = localParticipant ? localParticipant.getTrackPublication(Track.Source.Camera) : null;
  const localAudioPub = localParticipant ? localParticipant.getTrackPublication(Track.Source.Microphone) : null;
  const isLocalVideoPublished = !!localVideoPub && !localVideoPub.isMuted;
  const isLocalAudioPublished = !!localAudioPub && !localAudioPub.isMuted;

  const remoteVideoPub = remoteParticipant ? remoteParticipant.getTrackPublication(Track.Source.Camera) : null;
  const remoteAudioPub = remoteParticipant ? remoteParticipant.getTrackPublication(Track.Source.Microphone) : null;
  const isRemoteVideoPublished = !!remoteVideoPub && !!remoteVideoPub.track && !remoteVideoPub.isMuted;
  const isRemoteAudioPublished = !!remoteAudioPub && !!remoteAudioPub.track && !remoteAudioPub.isMuted;

  // Render diagnostics logging
  console.log('[MediaGrid-Render] Diagnostics:', {
    connectionState: room?.state,
    localParticipant: {
      identity: localParticipant?.identity,
      isCameraEnabled,
      isMicrophoneEnabled,
      localCameraActive,
      localMicActive,
      cameraSyncing,
      micSyncing,
      isLocalVideoPublished,
      isLocalAudioPublished,
    },
    remoteParticipant: remoteParticipant ? {
      identity: remoteParticipant.identity,
      isCameraEnabled: remoteParticipant.isCameraEnabled,
      isMicrophoneEnabled: remoteParticipant.isMicrophoneEnabled,
      isRemoteVideoPublished,
      isRemoteAudioPublished,
    } : null,
    tracksCount: tracks.length,
    tracks: tracks.map(t => ({
      participant: t.participant?.identity,
      source: t.source,
      isPlaceholder: (t as any).placeholder,
      trackSid: (t as any).track?.sid,
    }))
  });

  // 8. Connection state mapping
  const conn = getConnectionLabel(connectionStatus);

  // Local/Remote Video TrackReferences
  const localVideoTrackRef = tracks.find(
    (t) => t.participant.identity === localParticipant?.identity && t.source === Track.Source.Camera
  ) as any;
  const remoteVideoTrackRef = remoteParticipant
    ? (tracks.find((t) => t.participant.identity === remoteParticipant.identity && t.source === Track.Source.Camera) as any)
    : null;

  // Local Video Track diagnostics on mount / update
  useEffect(() => {
    console.log('[LocalVideoTile-Diag] Render state check:', {
      localParticipantSid: localParticipant?.sid,
      localParticipantIdentity: localParticipant?.identity,
      localCameraActive,
      hasLocalVideoTrackRef: !!localVideoTrackRef,
      localVideoTrackSid: localVideoTrackRef?.publication?.trackSid || localVideoTrackRef?.track?.sid || 'None',
      isLocalVideoPublished,
      cameraSyncing,
    });
  }, [localParticipant, localCameraActive, localVideoTrackRef, isLocalVideoPublished, cameraSyncing]);

  const handleToggleMute = () => {
    if (micSyncing || !localParticipant) return;
    setLocalMicActive(prev => !prev);
  };

  const handleToggleCamera = () => {
    if (cameraSyncing || !localParticipant) return;
    setLocalCameraActive(prev => !prev);
  };

  const handleLeaveCall = () => {
    room?.disconnect();
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-zinc-905">
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 min-h-[300px] bg-zinc-950/40">
        
        {/* 1. Local Participant Tile (Always Visible) */}
        <div className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center">
          {localVideoTrackRef && (
            <div className={`w-full h-full [&>video]:object-cover absolute inset-0 z-10 ${!localCameraActive ? 'hidden' : ''}`}>
              <VideoTrack trackRef={localVideoTrackRef} className="w-full h-full object-cover scale-x-[-1]" />
              <LocalVideoTileDiagnostic
                identity={localParticipant?.identity || 'unknown'}
                sid={localParticipant?.sid || 'unknown'}
                trackSid={localVideoTrackRef?.publication?.trackSid || localVideoTrackRef?.track?.sid || 'unknown'}
                isPublished={isLocalVideoPublished}
              />
            </div>
          )}
          
          {!localCameraActive ? (
            <div className="flex flex-col items-center justify-center text-zinc-500 bg-zinc-950/60 w-full h-full select-none z-0">
              <svg className="w-12 h-12 mb-2 text-zinc-750" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">🔴 Camera Off</span>
            </div>
          ) : !localVideoTrackRef && (
            <div className="flex flex-col items-center justify-center text-zinc-500 bg-zinc-950/60 w-full h-full select-none gap-2 z-0">
              <svg className="w-8 h-8 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">Starting camera...</span>
            </div>
          )}

          {/* 4. Participant Media Status Overlay (Local) */}
          <div className="absolute top-3 left-3 bg-zinc-950/90 border border-zinc-800/80 rounded-lg p-2.5 text-[10px] text-zinc-300 space-y-1.5 backdrop-blur-sm shadow-xl min-w-[120px] z-10 select-none">
            <div className="font-bold text-indigo-400 uppercase tracking-wider border-b border-zinc-800/50 pb-0.5">You ({role})</div>
            <div className="flex items-center justify-between gap-2.5">
              <span className="text-zinc-500">Camera:</span>
              <span className={`font-semibold ${localCameraActive && isLocalVideoPublished ? 'text-emerald-400' : cameraSyncing ? 'text-amber-400 animate-pulse' : 'text-red-400'}`}>
                {localCameraActive && isLocalVideoPublished ? 'ON' : cameraSyncing ? 'SYNCING' : 'OFF'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2.5">
              <span className="text-zinc-500">Microphone:</span>
              <span className={`font-semibold ${localMicActive && isLocalAudioPublished ? 'text-emerald-400' : micSyncing ? 'text-amber-400 animate-pulse' : 'text-red-400'}`}>
                {localMicActive && isLocalAudioPublished ? 'ON' : micSyncing ? 'SYNCING' : 'MUTED'}
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
            <>
              {remoteVideoTrackRef && (
                <div className={`w-full h-full [&>video]:object-cover absolute inset-0 z-10 ${!remoteParticipant.isCameraEnabled ? 'hidden' : ''}`}>
                  <VideoTrack trackRef={remoteVideoTrackRef} className="w-full h-full object-cover" />
                </div>
              )}
              
              {!remoteParticipant.isCameraEnabled ? (
                <div className="flex flex-col items-center justify-center text-zinc-500 bg-zinc-950/60 w-full h-full select-none z-0">
                  <svg className="w-12 h-12 mb-2 text-zinc-750" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">🔴 Camera Off</span>
                </div>
              ) : !remoteVideoTrackRef && (
                <div className="flex flex-col items-center justify-center text-zinc-500 bg-zinc-950/60 w-full h-full select-none gap-2 z-0">
                  <svg className="w-8 h-8 animate-spin text-violet-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">Loading feed...</span>
                </div>
              )}
            </>
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
            onClick={handleReconnectMedia}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px] font-bold uppercase text-indigo-400 hover:text-indigo-300 transition-all active:scale-95 flex items-center gap-1.5"
            title="Force reconnect media stream"
          >
            🔄 Reconnect Media
          </button>
          
          <button
            onClick={handleToggleMute}
            disabled={micSyncing}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5 ${
              micSyncing
                ? 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500 cursor-not-allowed'
                : localMicActive
                ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                : 'bg-red-950/40 border-red-900/30 text-red-400 hover:bg-red-900/20'
            }`}
          >
            {micSyncing ? (
              <>
                <svg className="w-3 h-3 animate-spin text-zinc-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Syncing...</span>
              </>
            ) : localMicActive ? (
              '🟢 Mic On'
            ) : (
              '🔴 Mic Muted'
            )}
          </button>
          
          <button
            onClick={handleToggleCamera}
            disabled={cameraSyncing}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5 ${
              cameraSyncing
                ? 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500 cursor-not-allowed'
                : localCameraActive
                ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                : 'bg-red-950/40 border-red-900/30 text-red-400 hover:bg-red-900/20'
            }`}
          >
            {cameraSyncing ? (
              <>
                <svg className="w-3 h-3 animate-spin text-zinc-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Syncing...</span>
              </>
            ) : localCameraActive ? (
              '🟢 Camera On'
            ) : (
              '🔴 Camera Off'
            )}
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
            <div><span className="text-zinc-650">Connection State:</span> {connectionStatus.toUpperCase()}</div>
            <div><span className="text-zinc-650">Identity:</span> {localParticipant?.identity || 'N/A'}</div>
            <div><span className="text-zinc-650">Sid:</span> {localParticipant?.sid || 'N/A'}</div>
            <div><span className="text-zinc-650">Published Video:</span> {isLocalVideoPublished ? '🟢 Active' : '🔴 Muted/Inactive'}</div>
            <div><span className="text-zinc-650">Published Audio:</span> {isLocalAudioPublished ? '🟢 Active' : '🔴 Muted/Inactive'}</div>
            <div><span className="text-zinc-650">Video Track:</span> {localVideoPub?.trackSid || 'None'}</div>
            <div><span className="text-zinc-650">Audio Track:</span> {localAudioPub?.trackSid || 'None'}</div>
          </div>
          <div className="pt-2 border-t border-zinc-900">
            <div className="text-zinc-500 font-bold mb-1">Subscribed Remote Tracks:</div>
            {participants.filter(p => p.identity !== localParticipant?.identity).map(p => {
              const videoTracks = Array.from(p.videoTrackPublications.values() as any) as any[];
              const audioTracks = Array.from(p.audioTrackPublications.values() as any) as any[];
              return (
                <div key={p.identity} className="space-y-0.5">
                  <div className="text-zinc-300 font-semibold">{p.identity} ({p.sid}):</div>
                  <div className="pl-3 text-zinc-505">
                    - Video: {videoTracks.map(t => `${t.trackSid} (Subscribed: ${t.isSubscribed ? 'Yes' : 'No'}, Muted: ${t.isMuted ? 'Yes' : 'No'})`).join(', ') || 'None'}
                  </div>
                  <div className="pl-3 text-zinc-505">
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

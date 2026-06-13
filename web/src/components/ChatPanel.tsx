import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, Participant } from '@/lib/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  participants: Participant[];
  currentParticipantId: string | null;
  sessionStatus: 'CREATED' | 'ACTIVE' | 'ABANDONED' | 'ENDED';
  onSendMessage: (content: string) => void;
}

export const translateSystemMessage = (content: string): string => {
  const text = content.trim().toLowerCase();
  
  if (text.includes("joined the session") || text.includes("joined the conversation") || text.includes("participant_connected") || text.includes("participant_joined")) {
    if (text.includes("agent")) {
      return "Agent joined the conversation";
    }
    if (text.includes("customer")) {
      return "Customer joined the conversation";
    }
    return "Agent joined the conversation";
  }
  
  if (text.includes("left the session") || text.includes("left the conversation")) {
    if (text.includes("agent")) {
      return "Agent left the conversation";
    }
    if (text.includes("customer")) {
      return "Customer left the conversation";
    }
    return "Customer left the conversation";
  }

  if (text.includes("disconnected") || text.includes("connection lost")) {
    if (text.includes("agent")) {
      return "Agent left the conversation";
    }
    if (text.includes("customer")) {
      return "Customer left the conversation";
    }
    return "Connection interrupted";
  }

  if (text.includes("reconnected")) {
    if (text.includes("agent")) {
      return "Agent joined the conversation";
    }
    if (text.includes("customer")) {
      return "Customer joined the conversation";
    }
    return "Connection restored";
  }

  if (text.includes("support session started") || text.includes("session active") || text.includes("connection established") || text.includes("session_active") || text.includes("session_started")) {
    return "Support session started";
  }

  if (text.includes("video consultation started") || text.includes("video started") || text.includes("livekit_connected")) {
    return "Video consultation started";
  }

  if (text.includes("video consultation ended") || text.includes("video stopped")) {
    return "Video consultation ended";
  }

  if (text.includes("support session abandoned")) {
    return "Support session paused";
  }

  if (text.includes("support session resumed")) {
    return "Support session started";
  }

  return content;
};

export default function ChatPanel({
  messages,
  participants,
  currentParticipantId,
  sessionStatus,
  onSendMessage,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const isReadOnly = sessionStatus === 'ENDED';
  const isAbandoned = sessionStatus === 'ABANDONED';
  const isNotJoined = !currentParticipantId;

  // Helper to find participant/user details for the sender
  const getSenderName = (senderId: string | null) => {
    if (!senderId) return 'System';
    const participant = participants.find((p) => p.id === senderId);
    if (!participant) return 'Participant';
    return participant.role.toLowerCase() === 'agent' ? 'Support Agent' : participant.user_id;
  };

  return (
    <div className="flex flex-col h-[580px] rounded-2xl bg-zinc-900/50 border border-zinc-800/80 backdrop-blur-sm shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/80 flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-wide text-zinc-350 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
          Live Conversation
        </h3>
        <span className="text-xs text-zinc-500 font-medium">
          {messages.filter(m => m.message_type !== 'SYSTEM').length} messages
        </span>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 p-6 overflow-y-auto space-y-6 scrollbar-thin">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-sm text-zinc-400 space-y-3 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-zinc-200">Start the Conversation</p>
              <p className="text-xs text-zinc-500 max-w-[280px] leading-relaxed">
                Messages exchanged during the consultation will appear here. Chat history is automatically saved.
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isSystem = msg.message_type === 'SYSTEM';
            const isMe = msg.sender_participant_id === currentParticipantId;

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center my-4">
                  <div className="px-4 py-1.5 rounded-full bg-zinc-950/40 border border-zinc-900/60 text-xs text-zinc-500 font-medium tracking-wide max-w-sm text-center">
                    {translateSystemMessage(msg.content)}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1.5`}
              >
                <span className="text-xs text-zinc-500 font-medium px-2">
                  {isMe ? 'You' : getSenderName(msg.sender_participant_id)}
                </span>
                <div
                  className={`max-w-[75%] rounded-2xl px-5 py-3 text-sm leading-relaxed shadow-sm ${
                    isMe
                      ? 'bg-purple-600 text-zinc-100 rounded-tr-none'
                      : 'bg-zinc-800 text-zinc-200 rounded-tl-none border border-zinc-750'
                  }`}
                >
                  {msg.content}
                </div>
                <span className="text-[10px] text-zinc-600 px-2 font-medium">
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer / MessageComposer */}
      <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/80">
        {isReadOnly ? (
          <div className="py-2.5 px-4 rounded-xl bg-zinc-950/40 border border-zinc-900/60 text-center text-xs text-zinc-500 font-medium">
            This support session has ended
          </div>
        ) : isAbandoned ? (
          <div className="py-2.5 px-4 rounded-xl bg-zinc-950/40 border border-zinc-900/60 text-center text-xs text-zinc-400 font-medium animate-pulse">
            Connection lost. Attempting to reconnect...
          </div>
        ) : isNotJoined ? (
          <div className="py-2.5 px-4 rounded-xl bg-zinc-950/40 border border-zinc-900/60 text-center text-xs text-purple-400 font-medium">
            Connecting to session...
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-850 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-purple-500/80 transition-all"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="px-5 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium shadow-md active:scale-98 transition-all shrink-0 cursor-pointer"
            >
              Send
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

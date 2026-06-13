import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, Participant } from '@/lib/types';

interface ChatPanelProps {
  messages: ChatMessage[];
  participants: Participant[];
  currentParticipantId: string | null;
  sessionStatus: 'CREATED' | 'ACTIVE' | 'ABANDONED' | 'ENDED';
  onSendMessage: (content: string) => void;
  className?: string;
}

export default function ChatPanel({
  messages,
  participants,
  currentParticipantId,
  sessionStatus,
  onSendMessage,
  className = "h-[500px]",
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
    if (!participant) return `User (${senderId.substring(0, 4)})`;
    return `${participant.user_id} (${participant.role})`;
  };

  return (
    <div className={`flex flex-col rounded-2xl bg-zinc-900 border border-zinc-800/80 shadow-xl shadow-black/30 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Chat Room
        </h3>
        <span className="text-[10px] bg-zinc-950 px-2 py-0.5 rounded text-zinc-500 font-mono">
          {messages.length} messages
        </span>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 p-6 overflow-y-auto space-y-4 scrollbar-thin">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-zinc-500 italic">
            No messages yet. Send a message to start the conversation.
          </div>
        ) : (
          messages.map((msg) => {
            const isSystem = msg.message_type === 'SYSTEM';
            const isMe = msg.sender_participant_id === currentParticipantId;

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <div className="px-3 py-1 rounded-full bg-zinc-950/60 border border-zinc-800/40 text-[10px] text-zinc-500 italic max-w-xs text-center">
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <span className="text-[10px] text-zinc-500 mb-1 px-1">
                  {getSenderName(msg.sender_participant_id)}
                </span>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-xs leading-relaxed ${
                    isMe
                      ? 'bg-indigo-600 text-white rounded-tr-none'
                      : 'bg-zinc-800 text-zinc-200 rounded-tl-none'
                  }`}
                >
                  {msg.content}
                </div>
                <span className="text-[9px] text-zinc-600 mt-1 px-1">
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer / MessageComposer */}
      <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/50">
        {isReadOnly ? (
          <div className="py-2 px-3 rounded-lg bg-zinc-950/40 border border-zinc-800 text-center text-xs text-zinc-500">
            ⚠️ Chat history is read-only (Session has ended)
          </div>
        ) : isAbandoned ? (
          <div className="py-2 px-3 rounded-lg bg-amber-950/40 border border-amber-800/40 text-center text-xs text-amber-400">
            ⏳ Session abandoned — waiting for reconnect. Chat paused.
          </div>
        ) : isNotJoined ? (
          <div className="py-2 px-3 rounded-lg bg-zinc-950/40 border border-zinc-800 text-center text-xs text-indigo-400">
            Join the session to start chatting
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 px-4 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500/80 transition-all"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs font-semibold shadow-md active:scale-95 transition-all shrink-0"
            >
              Send
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

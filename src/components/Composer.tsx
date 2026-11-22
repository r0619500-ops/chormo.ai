import React, { useEffect, useRef } from 'react';
import { ArrowUp, Mic, MicOff, Square } from 'lucide-react';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onToggleVoice: () => void;
  isStreaming: boolean;
  isListening: boolean;
  voiceSupported: boolean;
  notice: string | null;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  onToggleVoice,
  isStreaming,
  isListening,
  voiceSupported,
  notice,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && value.trim()) {
        onSubmit();
      }
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isStreaming) {
      onStop();
    } else if (value.trim()) {
      onSubmit();
    }
  };

  const canSend = value.trim().length > 0;

  return (
    <footer className="px-4 pb-4 pt-2 shrink-0 bg-white dark:bg-zinc-950">
      <div className="max-w-[760px] mx-auto">
        {notice && (
          <div
            role="status"
            className="mb-2.5 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-600 dark:text-zinc-300 text-center"
          >
            {notice}
          </div>
        )}

        <form
          onSubmit={handleFormSubmit}
          className="flex items-end gap-2 pl-4 pr-2.5 py-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm focus-within:border-blue-500 dark:focus-within:border-sky-500 transition-colors"
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message CHROMO AI..."
            aria-label="Message CHROMO AI"
            className="flex-1 min-h-[26px] max-h-[168px] py-1 bg-transparent text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 resize-none outline-none"
          />

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onToggleVoice}
              title={
                !voiceSupported
                  ? 'Voice input unavailable in this browser'
                  : isListening
                    ? 'Stop voice input'
                    : 'Voice input'
              }
              aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
              className={[
                'w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer',
                isListening
                  ? 'bg-red-500/15 text-red-600 dark:text-red-400 ring-2 ring-red-500/30'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100',
              ].join(' ')}
            >
              {isListening ? <MicOff className="w-[18px] h-[18px]" /> : <Mic className="w-[18px] h-[18px]" />}
            </button>

            <button
              type="submit"
              disabled={!isStreaming && !canSend}
              title={isStreaming ? 'Stop generating' : 'Send message'}
              aria-label={isStreaming ? 'Stop generating' : 'Send message'}
              className={[
                'w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer',
                isStreaming
                  ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-700'
                  : canSend
                    ? 'bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-zinc-950'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed',
              ].join(' ')}
            >
              {isStreaming ? (
                <Square className="w-4 h-4 fill-current" />
              ) : (
                <ArrowUp className="w-[18px] h-[18px] stroke-[2.25]" />
              )}
            </button>
          </div>
        </form>

        <p className="mt-2 text-center text-[11.5px] text-zinc-400 dark:text-zinc-500">
          CHROMO AI can make mistakes. Verify important information.
        </p>
      </div>
    </footer>
  );
}

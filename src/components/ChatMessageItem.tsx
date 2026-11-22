import { useState } from 'react';
import { AlertCircle, Check, Copy, RotateCcw, Square, Volume2 } from 'lucide-react';
import type { ChatMessage } from '../types/chat';
import { ChromoLogo } from './ChromoLogo';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatMessageItemProps {
  message: ChatMessage;
  isLast: boolean;
  isStreaming: boolean;
  isSpeaking: boolean;
  ttsSupported: boolean;
  onToggleSpeak: (message: ChatMessage) => void;
  onRegenerate: () => void;
}

export function ChatMessageItem({
  message,
  isLast,
  isStreaming,
  isSpeaking,
  ttsSupported,
  onToggleSpeak,
  onRegenerate,
}: ChatMessageItemProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[76%] px-4 py-2.5 rounded-2xl rounded-br-sm bg-zinc-100 dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 text-[15px] leading-relaxed whitespace-pre-wrap break-words border border-zinc-200/70 dark:border-zinc-700/60">
          {message.content}
        </div>
      </div>
    );
  }

  const isPending = isStreaming && isLast && !message.content && !message.error;
  const showActions = !message.error && !(isStreaming && isLast) && Boolean(message.content);

  return (
    <div className="group flex items-start gap-3.5">
      <div className="mt-0.5">
        <ChromoLogo size="sm" />
      </div>

      <div className="flex-1 min-w-0">
        {message.error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/35 text-red-700 dark:text-red-300 text-sm"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{message.error}</span>
            </div>
            <button
              type="button"
              onClick={onRegenerate}
              className="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : isPending ? (
          <div className="flex items-center gap-1.5 py-2.5" aria-label="Generating response">
            <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-sky-400 chromo-dot-1" />
            <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-sky-400 chromo-dot-2" />
            <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-sky-400 chromo-dot-3" />
          </div>
        ) : (
          <div className="min-w-0">
            <MarkdownRenderer content={message.content} />
            {isStreaming && isLast && (
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-4 ml-1 align-middle rounded-xs bg-blue-600 dark:bg-sky-400 animate-pulse"
              />
            )}
          </div>
        )}

        {showActions && (
          <div
            className={[
              'flex flex-wrap items-center gap-1 mt-2.5 transition-opacity duration-150',
              isLast || isSpeaking
                ? 'opacity-100'
                : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={handleCopy}
              title="Copy response"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>

            {ttsSupported && (
              <button
                type="button"
                onClick={() => onToggleSpeak(message)}
                title={isSpeaking ? 'Stop reading' : 'Read aloud'}
                className={[
                  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                  isSpeaking
                    ? 'text-blue-600 dark:text-sky-400 bg-blue-50 dark:bg-sky-950/40'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80',
                ].join(' ')}
              >
                {isSpeaking ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span>Stop</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Listen</span>
                  </>
                )}
              </button>
            )}

            {isLast && (
              <button
                type="button"
                onClick={onRegenerate}
                title="Regenerate response"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Regenerate</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

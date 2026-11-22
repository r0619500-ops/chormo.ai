import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, ChevronDown, Moon, PanelLeftOpen, SquarePen, Sun } from 'lucide-react';
import { ChatMessageItem } from './components/ChatMessageItem';
import { ChromoLogo } from './components/ChromoLogo';
import { Composer } from './components/Composer';
import { Sidebar } from './components/Sidebar';
import { VoiceMode } from './components/VoiceMode';
import {
  cleanTextForSpeech,
  getSupportedAudioMimeType,
  selectBestFemaleVoice,
  transcribeAudioBlob,
} from './utils/voiceSpeech';
import { MODEL_OPTIONS } from './types/chat';
import type { ChatMessage, Conversation, ModelOption } from './types/chat';

const STORAGE_KEYS = {
  CHATS: 'chromo_ai_chats_v1',
  ACTIVE_ID: 'chromo_ai_active_id_v1',
  THEME: 'chromo_ai_theme_v1',
  MODEL: 'chromo_ai_model_v1',
};

const STARTER_PROMPTS = [
  {
    label: 'Explain clearly',
    title: 'How quantum error correction works in simple terms',
    prompt: 'Explain how quantum error correction works in 4 concise, clear sentences.',
  },
  {
    label: 'Write code',
    title: 'TypeScript debounce helper with clean usage example',
    prompt: 'Write a clean TypeScript debounce utility function with a short usage example.',
  },
  {
    label: 'Draft message',
    title: 'Concise follow-up email after a product interview',
    prompt: 'Draft a concise, thoughtful follow-up email after a product engineering interview.',
  },
  {
    label: 'Brainstorm',
    title: '5 practical habits for shipping better software faster',
    prompt: 'Share 5 focused, practical habits for shipping reliable software faster.',
  },
];

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CHATS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.ACTIVE_ID);
    } catch {
      return null;
    }
  });

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'dark';
  });

  const [model, setModel] = useState<ModelOption['id']>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.MODEL);
      if (MODEL_OPTIONS.some((m) => m.id === saved)) {
        return saved as ModelOption['id'];
      }
    } catch {
      // Ignore storage error
    }
    return 'gemini-3.1-flash-lite';
  });

  const [input, setInput] = useState('');
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const dictationRecorderRef = useRef<MediaRecorder | null>(null);
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<Conversation[]>(conversations);
  conversationsRef.current = conversations;

  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const voiceSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return (
      Boolean(getSpeechRecognitionCtor()) ||
      (typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia))
    );
  }, []);

  const showNotice = useCallback((msg: string, duration = 3500) => {
    setNotice(msg);
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
    }, duration);
  }, []);

  // Ensure activeId points to an existing conversation if present
  const activeConversation = useMemo(() => {
    if (!activeId) return conversations[0] || null;
    return conversations.find((c) => c.id === activeId) || conversations[0] || null;
  }, [conversations, activeId]);

  const activeIdRef = useRef<string | null>(activeConversation?.id || null);
  activeIdRef.current = activeConversation?.id || null;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(conversations));
      if (activeConversation?.id) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_ID, activeConversation.id);
      } else {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE_ID);
      }
    } catch {
      // Ignore quota errors
    }
  }, [conversations, activeConversation?.id]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.MODEL, model);
    } catch {
      // Ignore storage errors
    }
  }, [model]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      recognitionRef.current?.stop();
      if (dictationRecorderRef.current && dictationRecorderRef.current.state !== 'inactive') {
        try {
          dictationRecorderRef.current.stop();
        } catch {
          // Ignore
        }
      }
      dictationStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = viewportRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeConversation?.messages.length, isStreaming, scrollToBottom]);

  const stopSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageId(null);
  }, []);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const handleToggleSpeak = useCallback(
    (msg: ChatMessage) => {
      if (!ttsSupported) {
        showNotice('Text-to-speech is not supported in this browser.');
        return;
      }

      if (speakingMessageId === msg.id) {
        stopSpeech();
        return;
      }

      window.speechSynthesis.cancel();
      const clean = cleanTextForSpeech(msg.content);
      if (!clean) return;

      const utterance = new SpeechSynthesisUtterance(clean);
      const femaleVoice = selectBestFemaleVoice(window.speechSynthesis.getVoices());
      if (femaleVoice) {
        utterance.voice = femaleVoice;
      }
      utterance.rate = 0.99;
      utterance.pitch = 1.06;
      utterance.onend = () => setSpeakingMessageId(null);
      utterance.onerror = () => setSpeakingMessageId(null);

      setSpeakingMessageId(msg.id);
      window.speechSynthesis.speak(utterance);
    },
    [ttsSupported, speakingMessageId, stopSpeech, showNotice]
  );

  const startAudioDictationFallback = useCallback(
    async (baseText: string) => {
      if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        showNotice('Voice dictation is not supported in this browser.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        dictationStreamRef.current = stream;
        const mimeType = getSupportedAudioMimeType();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          setIsListening(false);
          dictationRecorderRef.current = null;
          dictationStreamRef.current?.getTracks().forEach((t) => t.stop());
          dictationStreamRef.current = null;

          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
          if (blob.size < 800) return;

          showNotice('Transcribing speech…', 6000);
          const { transcript, error } = await transcribeAudioBlob(blob);
          if (error) {
            showNotice(error);
          } else if (transcript) {
            setInput(baseText ? `${baseText} ${transcript}` : transcript);
            showNotice('Transcribed.', 1500);
          } else {
            showNotice('No speech detected.', 2000);
          }
        };

        dictationRecorderRef.current = recorder;
        recorder.start(250);
        setIsListening(true);
        showNotice('Listening… tap mic again when finished', 10000);
      } catch (err) {
        setIsListening(false);
        const e = err as { name?: string };
        if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
          showNotice('Microphone access was denied. Enable permissions in your browser settings.');
        } else {
          showNotice('Could not start microphone recording.');
        }
      }
    },
    [showNotice]
  );

  const handleToggleVoice = useCallback(() => {
    if (isListening && dictationRecorderRef.current) {
      dictationRecorderRef.current.stop();
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const baseText = input.trim();
    const SpeechRec = getSpeechRecognitionCtor();
    if (!SpeechRec) {
      void startAudioDictationFallback(baseText);
      return;
    }

    const recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
      recognitionRef.current = recognition;
      showNotice('Listening… speak now', 5000);
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(baseText ? `${baseText} ${transcript}` : transcript);
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        showNotice('Microphone access was denied. Enable permissions in your browser settings.');
      } else if (event.error === 'network' || event.error === 'service-not-allowed') {
        recognitionRef.current = null;
        setIsListening(false);
        void startAudioDictationFallback(baseText);
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        showNotice(`Voice input error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
    } catch {
      void startAudioDictationFallback(baseText);
    }
  }, [isListening, input, showNotice, startAudioDictationFallback]);

  const streamReply = useCallback(
    async (chatId: string, historyForServer: Array<{ role: string; content: string }>) => {
      stopSpeech();

      const assistantMsgId = createId();
      const assistantPlaceholder: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        error: null,
      };

      setConversations((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? { ...c, updatedAt: Date.now(), messages: [...c.messages, assistantPlaceholder] }
            : c
        )
      );

      setIsStreaming(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: historyForServer,
          }),
        });

        if (!res.ok) {
          const errPayload = await res.json().catch(() => ({}));
          throw new Error(errPayload.error || `Request failed (${res.status})`);
        }

        if (!res.body) {
          throw new Error('Streaming response unavailable.');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

        const processEvents = (rawEvents: string[]) => {
          for (const evt of rawEvents) {
            const lines = evt.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr) continue;

              const parsed = JSON.parse(jsonStr) as {
                type: string;
                text?: string;
                message?: string;
              };

              if (parsed.type === 'delta' && parsed.text) {
                accumulated += parsed.text;
                const currentText = accumulated;
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === chatId
                      ? {
                          ...c,
                          updatedAt: Date.now(),
                          messages: c.messages.map((m) =>
                            m.id === assistantMsgId ? { ...m, content: currentText } : m
                          ),
                        }
                      : c
                  )
                );
                scrollToBottom();
              } else if (parsed.type === 'error') {
                throw new Error(parsed.message || 'Failed to generate a response.');
              }
            }
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer.trim()) {
              processEvents(buffer.replace(/\r\n/g, '\n').split('\n\n'));
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          processEvents(events);
        }

        if (!accumulated.trim()) {
          throw new Error('The model returned an empty response. Please try regenerating.');
        }
      } catch (err) {
        const errorObj = err as { name?: string; message?: string };
        if (errorObj?.name === 'AbortError') {
          setConversations((prev) =>
            prev.map((c) => {
              if (c.id !== chatId) return c;
              const target = c.messages.find((m) => m.id === assistantMsgId);
              if (target && !target.content.trim()) {
                return {
                  ...c,
                  messages: c.messages.filter((m) => m.id !== assistantMsgId),
                };
              }
              return c;
            })
          );
        } else {
          const messageText =
            typeof navigator !== 'undefined' && navigator.onLine === false
              ? 'You appear to be offline. Reconnect and try again.'
              : errorObj?.message || 'Unable to generate a response right now.';

          setConversations((prev) =>
            prev.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    updatedAt: Date.now(),
                    messages: c.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, error: messageText } : m
                    ),
                  }
                : c
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [model, stopSpeech, scrollToBottom]
  );

  const sendPrompt = useCallback(
    async (promptText: string) => {
      const clean = promptText.trim();
      if (!clean || isStreaming) return;

      const userMsg: ChatMessage = {
        id: createId(),
        role: 'user',
        content: clean,
      };

      let targetChatId = activeConversation?.id;
      let nextHistory: Array<{ role: string; content: string }> = [];

      if (!targetChatId) {
        targetChatId = createId();
        const newChat: Conversation = {
          id: targetChatId,
          title: clean.length > 44 ? `${clean.slice(0, 44)}…` : clean,
          updatedAt: Date.now(),
          messages: [userMsg],
        };
        setConversations((prev) => [newChat, ...prev]);
        setActiveId(targetChatId);
        nextHistory = [{ role: 'user', content: clean }];
      } else {
        const existing = conversations.find((c) => c.id === targetChatId);
        const existingMessages = existing?.messages || [];
        const updatedTitle =
          existingMessages.length === 0
            ? clean.length > 44
              ? `${clean.slice(0, 44)}…`
              : clean
            : existing?.title || 'New conversation';

        nextHistory = [...existingMessages, userMsg]
          .filter((m) => !m.error && m.content)
          .map((m) => ({ role: m.role, content: m.content }));

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  title: updatedTitle,
                  updatedAt: Date.now(),
                  messages: [...c.messages, userMsg],
                }
              : c
          )
        );
      }

      setInput('');
      await streamReply(targetChatId, nextHistory);
    },
    [isStreaming, activeConversation?.id, conversations, streamReply]
  );

  const handleVoiceTurn = useCallback(
    async (
      userText: string,
      onStreamDelta: (partialResponse: string) => void,
      signal: AbortSignal
    ): Promise<{ text: string; error?: string | null }> => {
      const clean = userText.trim();
      if (!clean) return { text: '', error: 'Empty message.' };

      const userMsg: ChatMessage = {
        id: createId(),
        role: 'user',
        content: clean,
      };
      const assistantMsgId = createId();
      const assistantPlaceholder: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        error: null,
      };

      let targetChatId = activeIdRef.current;
      let nextHistory: Array<{ role: string; content: string }> = [];

      if (!targetChatId) {
        targetChatId = createId();
        const newChat: Conversation = {
          id: targetChatId,
          title: clean.length > 44 ? `${clean.slice(0, 44)}…` : clean,
          updatedAt: Date.now(),
          messages: [userMsg, assistantPlaceholder],
        };
        conversationsRef.current = [newChat, ...conversationsRef.current];
        activeIdRef.current = targetChatId;
        setConversations(conversationsRef.current);
        setActiveId(targetChatId);
        nextHistory = [{ role: 'user', content: clean }];
      } else {
        const existing = conversationsRef.current.find((c) => c.id === targetChatId);
        const existingMessages = existing?.messages || [];
        const updatedTitle =
          existingMessages.length === 0
            ? clean.length > 44
              ? `${clean.slice(0, 44)}…`
              : clean
            : existing?.title || 'New conversation';

        nextHistory = [...existingMessages, userMsg]
          .filter((m) => !m.error && m.content)
          .map((m) => ({ role: m.role, content: m.content }));

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  title: updatedTitle,
                  updatedAt: Date.now(),
                  messages: [...c.messages, userMsg, assistantPlaceholder],
                }
              : c
          )
        );
      }

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            model,
            messages: nextHistory,
          }),
        });

        if (!res.ok) {
          const errPayload = await res.json().catch(() => ({}));
          throw new Error(errPayload.error || `Request failed (${res.status})`);
        }
        if (!res.body) {
          throw new Error('Streaming response unavailable.');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

        const processEvents = (rawEvents: string[]) => {
          for (const evt of rawEvents) {
            const lines = evt.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr) continue;

              const parsed = JSON.parse(jsonStr) as {
                type: string;
                text?: string;
                message?: string;
              };

              if (parsed.type === 'delta' && parsed.text) {
                accumulated += parsed.text;
                const currentText = accumulated;
                onStreamDelta(currentText);
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === targetChatId
                      ? {
                          ...c,
                          updatedAt: Date.now(),
                          messages: c.messages.map((m) =>
                            m.id === assistantMsgId ? { ...m, content: currentText } : m
                          ),
                        }
                      : c
                  )
                );
              } else if (parsed.type === 'error') {
                throw new Error(parsed.message || 'Failed to generate a response.');
              }
            }
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer.trim()) {
              processEvents(buffer.replace(/\r\n/g, '\n').split('\n\n'));
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          processEvents(events);
        }

        if (!accumulated.trim()) {
          throw new Error('The model returned an empty response. Please try again.');
        }

        return { text: accumulated };
      } catch (err) {
        const errorObj = err as { name?: string; message?: string };
        if (errorObj?.name === 'AbortError') {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === targetChatId
                ? {
                    ...c,
                    messages: c.messages.filter(
                      (m) => m.id !== assistantMsgId || m.content.trim().length > 0
                    ),
                  }
                : c
            )
          );
          return { text: '' };
        }

        const errMsg =
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? 'You appear to be offline. Reconnect and try again.'
            : errorObj?.message || 'Unable to generate a response right now.';

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetChatId
              ? {
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, error: errMsg } : m
                  ),
                }
              : c
          )
        );
        return { text: '', error: errMsg };
      }
    },
    [model]
  );

  const handleRegenerate = useCallback(async () => {
    if (isStreaming || !activeConversation) return;
    const msgs = activeConversation.messages;
    if (msgs.length === 0) return;

    const trimmed =
      msgs[msgs.length - 1].role === 'assistant' ? msgs.slice(0, -1) : msgs;

    const historyForServer = trimmed
      .filter((m) => !m.error && m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    if (historyForServer.length === 0) return;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversation.id
          ? { ...c, updatedAt: Date.now(), messages: trimmed }
          : c
      )
    );

    await streamReply(activeConversation.id, historyForServer);
  }, [isStreaming, activeConversation, streamReply]);

  const handleNewChat = useCallback(() => {
    stopStreaming();
    stopSpeech();
    setMobileSidebarOpen(false);

    if (activeConversation && activeConversation.messages.length === 0) {
      return;
    }

    const newChat: Conversation = {
      id: createId(),
      title: 'New conversation',
      updatedAt: Date.now(),
      messages: [],
    };
    setConversations((prev) => [newChat, ...prev]);
    setActiveId(newChat.id);
  }, [activeConversation, stopStreaming, stopSpeech]);

  const handleSelectChat = useCallback(
    (id: string) => {
      if (id === activeConversation?.id) return;
      stopStreaming();
      stopSpeech();
      setActiveId(id);
    },
    [activeConversation?.id, stopStreaming, stopSpeech]
  );

  const handleDeleteChat = useCallback(
    (id: string) => {
      if (id === activeConversation?.id) {
        stopStreaming();
        stopSpeech();
      }
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (id === activeConversation?.id) {
          setActiveId(remaining[0]?.id || null);
        }
        return remaining;
      });
    },
    [activeConversation?.id, stopStreaming, stopSpeech]
  );

  const messages = activeConversation?.messages || [];

  return (
    <div className="flex h-dvh overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <Sidebar
        conversations={conversations}
        activeId={activeConversation?.id || null}
        desktopOpen={desktopSidebarOpen}
        mobileOpen={mobileSidebarOpen}
        onCloseDesktop={() => setDesktopSidebarOpen(false)}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
      />

      <main className="flex-1 min-w-0 flex flex-col bg-white dark:bg-zinc-950">
        {/* Top Bar */}
        <header className="h-14 px-4 flex items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 768) {
                  setMobileSidebarOpen(true);
                } else {
                  setDesktopSidebarOpen(true);
                }
              }}
              aria-label="Open sidebar"
              title="Open sidebar"
              className={[
                'w-10 h-10 rounded-lg items-center justify-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer',
                desktopSidebarOpen ? 'flex md:hidden' : 'flex',
              ].join(' ')}
            >
              <PanelLeftOpen className="w-[18px] h-[18px]" />
            </button>

            <div className="relative">
              <select
                aria-label="Select Gemini model"
                value={model}
                onChange={(e) => setModel(e.target.value as ModelOption['id'])}
                className="appearance-none h-9 pl-3 pr-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 text-xs font-medium text-zinc-800 dark:text-zinc-200 outline-none cursor-pointer transition-colors"
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <div className="flex-1 min-w-0 flex justify-center">
            <h1 className="text-[13.5px] font-medium text-zinc-500 dark:text-zinc-400 truncate max-w-[320px]">
              {activeConversation?.title || 'New conversation'}
            </h1>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                stopSpeech();
                setVoiceModeOpen(true);
              }}
              aria-label="Open Voice Mode"
              title="Open Voice Mode"
              className="h-9 px-3 rounded-lg flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-sky-400 bg-blue-50 dark:bg-sky-500/10 hover:bg-blue-100 dark:hover:bg-sky-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <AudioLines className="w-4 h-4" />
              <span className="hidden sm:inline">Voice Mode</span>
            </button>
            <button
              type="button"
              onClick={handleNewChat}
              aria-label="New chat"
              title="New chat"
              className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <SquarePen className="w-[18px] h-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {theme === 'dark' ? (
                <Sun className="w-[18px] h-[18px]" />
              ) : (
                <Moon className="w-[18px] h-[18px]" />
              )}
            </button>
          </div>
        </header>

        {/* Central Chat Area */}
        <section
          ref={viewportRef}
          aria-live="polite"
          className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth"
        >
          <div className="max-w-[760px] mx-auto min-h-full flex flex-col">
            {messages.length === 0 ? (
              <div className="my-auto py-8 text-center">
                <div className="flex justify-center mb-5">
                  <ChromoLogo size="lg" />
                </div>
                <h2 className="font-display text-2xl sm:text-[28px] font-semibold tracking-tight text-zinc-950 dark:text-white text-balance">
                  What can I help you with?
                </h2>
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  CHROMO AI <span aria-hidden="true">·</span> Founded by Meet Shasane
                </p>

                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[620px] mx-auto text-left">
                  {STARTER_PROMPTS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => sendPrompt(item.prompt)}
                      className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors cursor-pointer"
                    >
                      <div className="text-xs font-medium text-blue-600 dark:text-sky-400">
                        {item.label}
                      </div>
                      <div className="mt-1 text-[13.5px] leading-snug text-zinc-700 dark:text-zinc-300">
                        {item.title}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6 pb-4">
                {messages.map((msg, idx) => (
                  <ChatMessageItem
                    key={msg.id}
                    message={msg}
                    isLast={idx === messages.length - 1}
                    isStreaming={isStreaming}
                    isSpeaking={speakingMessageId === msg.id}
                    ttsSupported={ttsSupported}
                    onToggleSpeak={handleToggleSpeak}
                    onRegenerate={handleRegenerate}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Message Composer */}
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => sendPrompt(input)}
          onStop={stopStreaming}
          onToggleVoice={handleToggleVoice}
          onOpenVoiceMode={() => {
            stopSpeech();
            setVoiceModeOpen(true);
          }}
          isStreaming={isStreaming}
          isListening={isListening}
          voiceSupported={voiceSupported}
          notice={notice}
        />
      </main>

      <VoiceMode
        isOpen={voiceModeOpen}
        onClose={() => setVoiceModeOpen(false)}
        onSendTurn={handleVoiceTurn}
      />
    </div>
  );
}

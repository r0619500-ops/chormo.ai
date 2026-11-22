import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, MicOff, RefreshCw, Square, Volume2, VolumeX, X } from 'lucide-react';
import { ChromoLogo } from './ChromoLogo';
import { VoiceOrbCanvas } from './VoiceOrbCanvas';
import type { VoiceOrbState } from './VoiceOrbCanvas';
import {
  cleanTextForSpeech,
  selectBestFemaleVoice,
  synthesizeGeminiSpeech,
} from '../utils/voiceSpeech';

interface VoiceModeProps {
  isOpen: boolean;
  onClose: () => void;
  onSendTurn: (
    userText: string,
    onStreamDelta: (partialResponse: string) => void,
    signal: AbortSignal
  ) => Promise<{ text: string; error?: string | null }>;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
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
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoiceMode({ isOpen, onClose, onSendTurn }: VoiceModeProps) {
  const [orbState, setOrbState] = useState<VoiceOrbState>('idle');
  const [micMuted, setMicMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [assistantTranscript, setAssistantTranscript] = useState('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [fallbackInput, setFallbackInput] = useState('');

  const audioLevelRef = useRef<number>(0);
  const isOpenRef = useRef(isOpen);
  const micMutedRef = useRef(micMuted);
  const speakerMutedRef = useRef(speakerMuted);
  const orbStateRef = useRef<VoiceOrbState>(orbState);

  isOpenRef.current = isOpen;
  micMutedRef.current = micMuted;
  speakerMutedRef.current = speakerMuted;
  orbStateRef.current = orbState;

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRafRef = useRef<number>(0);
  const silenceTimerRef = useRef<number | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fallbackSpeechRafRef = useRef<number>(0);
  const speechTokenRef = useRef<number>(0);
  const finalBufferRef = useRef<string>('');
  const speechSupported = Boolean(getSpeechRecognitionCtor());

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const stopMicAnalyser = useCallback(() => {
    if (analyserRafRef.current) {
      window.cancelAnimationFrame(analyserRafRef.current);
      analyserRafRef.current = 0;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    audioLevelRef.current = 0;
  }, []);

  const stopRecognition = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // Ignore abort errors
      }
    }
  }, []);

  const stopSpeakingAudio = useCallback(() => {
    speechTokenRef.current += 1;
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.onended = null;
        activeSourceRef.current.stop();
      } catch {
        // Ignore if already stopped
      }
      activeSourceRef.current = null;
    }
    if (fallbackSpeechRafRef.current) {
      window.cancelAnimationFrame(fallbackSpeechRafRef.current);
      fallbackSpeechRafRef.current = 0;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    audioLevelRef.current = 0;
  }, []);

  const stopAllActiveTurn = useCallback(() => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    stopSpeakingAudio();
  }, [stopSpeakingAudio]);

  const startMicMeter = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    if (mediaStreamRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!isOpenRef.current || micMutedRef.current || orbStateRef.current !== 'listening') {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      mediaStreamRef.current = stream;
      const ctx = ensureAudioContext();
      if (!ctx) return;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!mediaStreamRef.current || orbStateRef.current !== 'listening') {
          audioLevelRef.current = 0;
          return;
        }
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const normalized = (data[i] - 128) / 128;
          sumSq += normalized * normalized;
        }
        const rms = Math.sqrt(sumSq / data.length);
        audioLevelRef.current = Math.min(1, rms * 4.5);
        analyserRafRef.current = window.requestAnimationFrame(tick);
      };
      analyserRafRef.current = window.requestAnimationFrame(tick);
    } catch (err) {
      const e = err as { name?: string };
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        setErrorBanner(
          'Microphone permission was denied. Allow microphone access in your browser and tap Retry.'
        );
        setMicMuted(true);
        setOrbState('idle');
      }
    }
  }, [ensureAudioContext]);

  const startListeningRef = useRef<() => void>(() => {});

  const speakResponse = useCallback(
    async (text: string) => {
      const spoken = cleanTextForSpeech(text);
      if (!spoken || speakerMutedRef.current || !isOpenRef.current) {
        if (isOpenRef.current && !micMutedRef.current) {
          startListeningRef.current();
        } else {
          setOrbState('idle');
        }
        return;
      }

      const token = ++speechTokenRef.current;
      setOrbState('speaking');
      stopMicAnalyser();
      stopRecognition();

      const finishSpeaking = () => {
        if (speechTokenRef.current !== token) return;
        audioLevelRef.current = 0;
        if (isOpenRef.current && !micMutedRef.current) {
          startListeningRef.current();
        } else {
          setOrbState('idle');
        }
      };

      // 1. Try Gemini Female Voice TTS first
      const ttsController = new AbortController();
      ttsAbortRef.current = ttsController;

      const audioBufferData = await synthesizeGeminiSpeech(spoken, ttsController.signal);
      if (speechTokenRef.current !== token || !isOpenRef.current) return;

      if (audioBufferData) {
        try {
          const ctx = ensureAudioContext();
          if (ctx) {
            const decoded = await ctx.decodeAudioData(audioBufferData.slice(0));
            if (speechTokenRef.current !== token || !isOpenRef.current) return;

            const source = ctx.createBufferSource();
            source.buffer = decoded;

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.72;

            source.connect(analyser);
            analyser.connect(ctx.destination);
            activeSourceRef.current = source;

            const freqData = new Uint8Array(analyser.frequencyBinCount);
            const sampleSpeech = () => {
              if (speechTokenRef.current !== token || !activeSourceRef.current) {
                audioLevelRef.current = 0;
                return;
              }
              analyser.getByteTimeDomainData(freqData);
              let sumSq = 0;
              for (let i = 0; i < freqData.length; i++) {
                const v = (freqData[i] - 128) / 128;
                sumSq += v * v;
              }
              const rms = Math.sqrt(sumSq / freqData.length);
              audioLevelRef.current = Math.min(1, rms * 4.2);
              analyserRafRef.current = window.requestAnimationFrame(sampleSpeech);
            };

            source.onended = () => {
              if (activeSourceRef.current === source) {
                activeSourceRef.current = null;
              }
              if (analyserRafRef.current) {
                window.cancelAnimationFrame(analyserRafRef.current);
                analyserRafRef.current = 0;
              }
              finishSpeaking();
            };

            source.start(0);
            analyserRafRef.current = window.requestAnimationFrame(sampleSpeech);
            return;
          }
        } catch {
          // Fall through to browser female TTS
        }
      }

      // 2. Fallback to browser female-sounding SpeechSynthesis
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(spoken);
        const voices = window.speechSynthesis.getVoices();
        const femaleVoice = selectBestFemaleVoice(voices);
        if (femaleVoice) {
          utterance.voice = femaleVoice;
        }
        utterance.rate = 0.99;
        utterance.pitch = 1.06;

        let t = 0;
        const animateFallback = () => {
          if (speechTokenRef.current !== token) {
            audioLevelRef.current = 0;
            return;
          }
          t += 0.14;
          audioLevelRef.current = 0.25 + Math.abs(Math.sin(t) * Math.cos(t * 0.63)) * 0.55;
          fallbackSpeechRafRef.current = window.requestAnimationFrame(animateFallback);
        };

        utterance.onend = () => {
          if (fallbackSpeechRafRef.current) {
            window.cancelAnimationFrame(fallbackSpeechRafRef.current);
            fallbackSpeechRafRef.current = 0;
          }
          finishSpeaking();
        };

        utterance.onerror = () => {
          if (fallbackSpeechRafRef.current) {
            window.cancelAnimationFrame(fallbackSpeechRafRef.current);
            fallbackSpeechRafRef.current = 0;
          }
          finishSpeaking();
        };

        fallbackSpeechRafRef.current = window.requestAnimationFrame(animateFallback);
        window.speechSynthesis.speak(utterance);
        return;
      }

      finishSpeaking();
    },
    [ensureAudioContext, stopMicAnalyser, stopRecognition]
  );

  const submitSpokenTurn = useCallback(
    async (prompt: string) => {
      const clean = prompt.trim();
      if (!clean || !isOpenRef.current) return;

      stopRecognition();
      stopMicAnalyser();
      setErrorBanner(null);
      setUserTranscript(clean);
      setAssistantTranscript('');
      setOrbState('thinking');

      const controller = new AbortController();
      chatAbortRef.current = controller;

      try {
        const result = await onSendTurn(
          clean,
          (partial) => {
            if (isOpenRef.current) {
              setAssistantTranscript(partial);
            }
          },
          controller.signal
        );

        if (!isOpenRef.current || controller.signal.aborted) return;

        if (result.error) {
          setErrorBanner(result.error);
          if (!micMutedRef.current) {
            startListeningRef.current();
          } else {
            setOrbState('idle');
          }
          return;
        }

        if (result.text) {
          setAssistantTranscript(result.text);
          await speakResponse(result.text);
        } else if (!micMutedRef.current) {
          startListeningRef.current();
        } else {
          setOrbState('idle');
        }
      } catch (err) {
        const e = err as { name?: string; message?: string };
        if (e?.name === 'AbortError') return;
        setErrorBanner(e?.message || 'Unable to reach CHROMO AI right now.');
        if (!micMutedRef.current && isOpenRef.current) {
          startListeningRef.current();
        } else {
          setOrbState('idle');
        }
      } finally {
        if (chatAbortRef.current === controller) {
          chatAbortRef.current = null;
        }
      }
    },
    [onSendTurn, speakResponse, stopMicAnalyser, stopRecognition]
  );

  const startListening = useCallback(() => {
    if (!isOpenRef.current || micMutedRef.current) {
      setOrbState('idle');
      return;
    }

    const SpeechRec = getSpeechRecognitionCtor();
    setErrorBanner(null);
    setOrbState('listening');
    finalBufferRef.current = '';

    // Always try live mic audio meter for true audio-reactive orb
    void startMicMeter();

    if (!SpeechRec) {
      return;
    }

    stopRecognition();

    const recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onstart = () => {
      if (isOpenRef.current && !micMutedRef.current) {
        setOrbState('listening');
      }
    };

    recognition.onresult = (event) => {
      if (!isOpenRef.current || orbStateRef.current !== 'listening') return;

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const part = res[0].transcript;
        if (res.isFinal) {
          finalBufferRef.current = `${finalBufferRef.current} ${part}`.trim();
        } else {
          interim += part;
        }
      }

      const display = [finalBufferRef.current, interim.trim()].filter(Boolean).join(' ');
      if (display) {
        setUserTranscript(display);
      }

      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
      }

      if (finalBufferRef.current) {
        silenceTimerRef.current = window.setTimeout(() => {
          const textToSend = finalBufferRef.current.trim();
          finalBufferRef.current = '';
          if (textToSend && isOpenRef.current && orbStateRef.current === 'listening') {
            void submitSpokenTurn(textToSend);
          }
        }, 700);
      }
    };

    recognition.onerror = (event) => {
      if (!isOpenRef.current) return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setErrorBanner(
          'Microphone access was denied. Enable microphone permissions in your browser and tap Retry.'
        );
        setMicMuted(true);
        setOrbState('idle');
        stopMicAnalyser();
      } else if (event.error === 'audio-capture') {
        // Release getUserMedia meter if browser restricts concurrent capture
        stopMicAnalyser();
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setErrorBanner(`Voice recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;

      const pending = finalBufferRef.current.trim();
      finalBufferRef.current = '';
      if (pending && isOpenRef.current && orbStateRef.current === 'listening') {
        void submitSpokenTurn(pending);
        return;
      }

      if (isOpenRef.current && !micMutedRef.current && orbStateRef.current === 'listening') {
        // Keep listening continuously while active
        window.setTimeout(() => {
          if (isOpenRef.current && !micMutedRef.current && orbStateRef.current === 'listening') {
            startListeningRef.current();
          }
        }, 250);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // Ignore duplicate start race
    }
  }, [startMicMeter, stopMicAnalyser, stopRecognition, submitSpokenTurn]);

  startListeningRef.current = startListening;

  // Initialize / teardown when VoiceMode opens or closes
  useEffect(() => {
    if (!isOpen) {
      stopAllActiveTurn();
      stopRecognition();
      stopMicAnalyser();
      setOrbState('idle');
      return;
    }

    // Preload browser speech voices
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }

    setUserTranscript('');
    setAssistantTranscript('');
    setErrorBanner(null);
    setMicMuted(false);
    micMutedRef.current = false;

    const timer = window.setTimeout(() => {
      if (isOpenRef.current) {
        startListening();
      }
    }, 80);

    return () => {
      window.clearTimeout(timer);
      stopAllActiveTurn();
      stopRecognition();
      stopMicAnalyser();
    };
  }, [isOpen, startListening, stopAllActiveTurn, stopMicAnalyser, stopRecognition]);

  const handleInterruptAndListen = useCallback(() => {
    stopAllActiveTurn();
    if (micMutedRef.current) {
      setMicMuted(false);
      micMutedRef.current = false;
    }
    startListening();
  }, [startListening, stopAllActiveTurn]);

  const handleToggleMic = useCallback(() => {
    // If AI is speaking or thinking, tapping mic interrupts immediately and starts listening
    if (orbStateRef.current === 'speaking' || orbStateRef.current === 'thinking') {
      handleInterruptAndListen();
      return;
    }

    if (micMuted) {
      setMicMuted(false);
      micMutedRef.current = false;
      setErrorBanner(null);
      startListening();
    } else {
      setMicMuted(true);
      micMutedRef.current = true;
      stopRecognition();
      stopMicAnalyser();
      setOrbState('idle');
    }
  }, [handleInterruptAndListen, micMuted, startListening, stopMicAnalyser, stopRecognition]);

  const handleToggleSpeaker = useCallback(() => {
    const nextMuted = !speakerMuted;
    setSpeakerMuted(nextMuted);
    speakerMutedRef.current = nextMuted;
    if (nextMuted && orbStateRef.current === 'speaking') {
      stopSpeakingAudio();
      if (!micMutedRef.current) {
        startListening();
      } else {
        setOrbState('idle');
      }
    }
  }, [speakerMuted, startListening, stopSpeakingAudio]);

  const handleOrbClick = useCallback(() => {
    if (orbStateRef.current === 'speaking' || orbStateRef.current === 'thinking') {
      handleInterruptAndListen();
    } else {
      handleToggleMic();
    }
  }, [handleInterruptAndListen, handleToggleMic]);

  // Keyboard shortcuts inside Voice Mode (Escape to exit, Space to interrupt speaking)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (
        e.code === 'Space' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        if (orbStateRef.current === 'speaking' || orbStateRef.current === 'thinking') {
          e.preventDefault();
          handleInterruptAndListen();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, handleInterruptAndListen]);

  const handleFallbackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = fallbackInput.trim();
    if (!clean) return;
    setFallbackInput('');
    void submitSpokenTurn(clean);
  };

  if (!isOpen) return null;

  const statusLabel =
    orbState === 'listening'
      ? 'Listening'
      : orbState === 'thinking'
        ? 'Thinking'
        : orbState === 'speaking'
          ? 'Speaking'
          : micMuted
            ? 'Microphone muted'
            : 'Ready';

  const statusHint =
    orbState === 'speaking'
      ? 'Tap the orb or Stop to interrupt'
      : orbState === 'thinking'
        ? 'CHROMO AI is forming a reply'
        : orbState === 'listening'
          ? speechSupported
            ? 'Speak naturally — I will reply automatically'
            : 'Type below to speak with CHROMO AI'
          : 'Tap the microphone to resume listening';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="CHROMO AI Voice Mode"
      className="fixed inset-0 z-50 flex flex-col bg-[#05070e] text-zinc-100 overflow-hidden"
    >
      {/* Subtle ambient background glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(56,189,248,0.11),rgba(99,102,241,0.08)_38%,transparent_72%)]"
      />

      {/* Top Bar */}
      <header className="relative z-10 h-16 px-5 sm:px-8 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <ChromoLogo size="sm" />
          <span className="font-display font-bold text-sm tracking-tight text-white whitespace-nowrap shrink-0">
            CHROMO AI
          </span>
        </div>

        <div className="text-center">
          <div className="text-xs font-medium tracking-wide text-sky-300/90">
            {statusLabel}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Exit Voice Mode"
          title="Exit Voice Mode"
          className="w-11 h-11 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.1] text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Center Orb & Live Conversation Transcript */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-between px-4 pb-4">
        <div className="w-full max-w-[460px] flex-1 min-h-[220px] max-h-[380px] flex flex-col items-center justify-center">
          <VoiceOrbCanvas
            state={orbState}
            audioLevelRef={audioLevelRef}
            onOrbClick={handleOrbClick}
          />
        </div>

        <p className="text-xs text-zinc-400 mb-3 text-center">{statusHint}</p>

        {/* Live Conversation Text */}
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md px-5 py-4 space-y-2.5 max-h-[180px] overflow-y-auto">
          {errorBanner && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <span>{errorBanner}</span>
              <button
                type="button"
                onClick={() => {
                  setErrorBanner(null);
                  setMicMuted(false);
                  micMutedRef.current = false;
                  startListening();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {!userTranscript && !assistantTranscript && !errorBanner && (
            <p className="text-sm text-zinc-400 text-center">
              Say hello to start a natural voice conversation with CHROMO AI.
            </p>
          )}

          {userTranscript && (
            <div className="text-sm leading-relaxed text-zinc-300">
              <span className="text-xs font-medium text-sky-400 mr-2">You</span>
              <span>{userTranscript}</span>
            </div>
          )}

          {assistantTranscript && (
            <div className="text-[14.5px] leading-relaxed text-white">
              <span className="text-xs font-medium text-violet-300 mr-2">CHROMO</span>
              <span>{assistantTranscript}</span>
            </div>
          )}
        </div>

        {/* Fallback text input for browsers without SpeechRecognition */}
        {!speechSupported && (
          <form
            onSubmit={handleFallbackSubmit}
            className="mt-3 w-full max-w-xl flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.04]"
          >
            <input
              type="text"
              value={fallbackInput}
              onChange={(e) => setFallbackInput(e.target.value)}
              placeholder="Voice input unavailable in this browser — type to talk..."
              className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-500 outline-none py-1.5"
            />
            <button
              type="submit"
              disabled={!fallbackInput.trim() || orbState === 'thinking'}
              aria-label="Send message"
              className="w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white flex items-center justify-center cursor-pointer"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>

      {/* Bottom Controls Dock */}
      <footer className="relative z-10 px-4 pb-7 pt-2 flex items-center justify-center gap-4 shrink-0">
        <button
          type="button"
          onClick={handleToggleSpeaker}
          aria-label={speakerMuted ? 'Unmute AI voice' : 'Mute AI voice'}
          title={speakerMuted ? 'Unmute AI voice' : 'Mute AI voice'}
          className={[
            'w-12 h-12 rounded-full border flex items-center justify-center transition-colors cursor-pointer',
            speakerMuted
              ? 'border-amber-400/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
              : 'border-white/15 bg-white/[0.06] text-zinc-200 hover:bg-white/[0.12]',
          ].join(' ')}
        >
          {speakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>

        <button
          type="button"
          onClick={handleToggleMic}
          aria-label={
            orbState === 'speaking' || orbState === 'thinking'
              ? 'Interrupt and speak'
              : micMuted
                ? 'Unmute microphone'
                : 'Mute microphone'
          }
          title={
            orbState === 'speaking' || orbState === 'thinking'
              ? 'Interrupt and speak'
              : micMuted
                ? 'Unmute microphone'
                : 'Mute microphone'
          }
          className={[
            'w-16 h-16 rounded-full border flex items-center justify-center transition-all cursor-pointer shadow-lg',
            orbState === 'listening' && !micMuted
              ? 'border-cyan-400/60 bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-sky-500/25'
              : micMuted
                ? 'border-red-400/40 bg-red-500/15 text-red-300 hover:bg-red-500/25'
                : 'border-white/20 bg-white/[0.1] text-white hover:bg-white/[0.18]',
          ].join(' ')}
        >
          {micMuted && orbState !== 'speaking' && orbState !== 'thinking' ? (
            <MicOff className="w-6 h-6" />
          ) : (
            <Mic className="w-6 h-6" />
          )}
        </button>

        {(orbState === 'speaking' || orbState === 'thinking') ? (
          <button
            type="button"
            onClick={handleInterruptAndListen}
            aria-label="Stop speaking"
            title="Stop speaking"
            className="h-12 px-4 rounded-full border border-violet-400/40 bg-violet-500/20 hover:bg-violet-500/30 text-violet-100 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            aria-label="End voice session"
            title="End voice session"
            className="w-12 h-12 rounded-full border border-white/15 bg-white/[0.06] hover:bg-red-500/20 hover:border-red-400/40 text-zinc-200 hover:text-red-200 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </footer>
    </div>
  );
}

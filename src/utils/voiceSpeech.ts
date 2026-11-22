export function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' Here is a code example shown on screen. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FEMALE_VOICE_PRIORITY = [
  'google uk english female',
  'microsoft aria online',
  'microsoft jenny online',
  'microsoft ava online',
  'samantha',
  'karen',
  'victoria',
  'tessa',
  'moira',
  'fiona',
  'allison',
  'ava',
  'serena',
  'kate',
  'microsoft zira',
  'microsoft hazel',
  'microsoft susan',
  'google us english',
  'female',
];

const MALE_VOICE_HINTS = [
  'daniel',
  'alex',
  'fred',
  'jorge',
  'thomas',
  'oliver',
  'arthur',
  'rishi',
  'microsoft david',
  'microsoft mark',
  'microsoft george',
  'microsoft ryan',
  'google uk english male',
  'male',
];

export function selectBestFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const pool = englishVoices.length > 0 ? englishVoices : voices;

  for (const hint of FEMALE_VOICE_PRIORITY) {
    const match = pool.find((v) => v.name.toLowerCase().includes(hint));
    if (match) return match;
  }

  const nonMale = pool.find((v) => {
    const lower = v.name.toLowerCase();
    return !MALE_VOICE_HINTS.some((m) => lower.includes(m));
  });

  return nonMale || pool[0] || null;
}

export async function synthesizeGeminiSpeech(
  text: string,
  signal?: AbortSignal
): Promise<ArrayBuffer | null> {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) return null;

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ text: cleaned }),
    });

    if (!res.ok) return null;

    const payload = (await res.json().catch(() => null)) as {
      audioBase64?: string;
    } | null;

    if (!payload?.audioBase64) return null;

    const binary = atob(payload.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}

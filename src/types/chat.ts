export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  error?: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ModelOption {
  id: 'gemini-3.1-flash-lite' | 'gemini-4-hydrogen';
  label: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
];

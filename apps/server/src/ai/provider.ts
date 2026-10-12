// Picks the model provider from the environment.
//
// AI_PROVIDER can name one explicitly; otherwise the first key found wins, in
// the order below. Every provider except Anthropic is reached through its
// OpenAI-compatible chat endpoint, so one client (compat.ts) serves them all.

export type ProviderId = 'anthropic' | 'gemini' | 'openrouter' | 'groq' | 'ollama';

export interface Provider {
  id: ProviderId;
  label: string;
  model: string;
  /** OpenAI-compatible base URL (unused for Anthropic). */
  baseUrl: string;
  apiKey: string | null;
  headers: Record<string, string>;
}

const env = (k: string) => process.env[k]?.trim() || undefined;

const DEFAULTS: Record<ProviderId, { label: string; model: string; baseUrl: string; key?: string }> = {
  anthropic: { label: 'Claude', model: 'claude-opus-5-5', baseUrl: '', key: 'ANTHROPIC_API_KEY' },
  gemini: {
    label: 'Gemini',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    key: 'GEMINI_API_KEY',
  },
  openrouter: {
    label: 'OpenRouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    key: 'OPENROUTER_API_KEY',
  },
  groq: { label: 'Groq', model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY' },
  ollama: { label: 'Ollama', model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' },
};

function detect(): ProviderId | null {
  const named = env('AI_PROVIDER')?.toLowerCase();
  if (named) {
    if (named in DEFAULTS) return named as ProviderId;
    console.warn(`AI_PROVIDER="${named}" is not one of ${Object.keys(DEFAULTS).join(', ')}; falling back to auto-detect.`);
  }
  if (env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN') || env('ANTHROPIC_PROFILE')) return 'anthropic';
  if (env('GEMINI_API_KEY') || env('GOOGLE_API_KEY')) return 'gemini';
  if (env('OPENROUTER_API_KEY')) return 'openrouter';
  if (env('GROQ_API_KEY')) return 'groq';
  if (env('OLLAMA_HOST') || env('OLLAMA_MODEL')) return 'ollama';
  return null;
}

function build(): Provider | null {
  if (env('CORTEX_OFFLINE') === '1') return null;
  const id = detect();
  if (!id) return null;
  const d = DEFAULTS[id];
  const apiKey =
    id === 'gemini' ? env('GEMINI_API_KEY') ?? env('GOOGLE_API_KEY') ?? null
    : id === 'ollama' ? null
    : d.key ? env(d.key) ?? null
    : null;
  const ollamaHost = env('OLLAMA_HOST')?.replace(/\/+$/, '');
  return {
    id,
    label: d.label,
    model: env('AI_MODEL') ?? env('CORTEX_MODEL') ?? (id === 'ollama' ? env('OLLAMA_MODEL') : undefined) ?? d.model,
    baseUrl: env('AI_BASE_URL') ?? (id === 'ollama' && ollamaHost ? `${ollamaHost.replace(/\/v1$/, '')}/v1` : d.baseUrl),
    apiKey,
    // OpenRouter asks apps to identify themselves; harmless elsewhere.
    headers: id === 'openrouter' ? { 'HTTP-Referer': 'http://localhost', 'X-Title': 'CortexOrbit' } : {},
  };
}

export const provider = build();
export const aiEnabled = provider !== null;
export const MODEL = provider?.model ?? null;

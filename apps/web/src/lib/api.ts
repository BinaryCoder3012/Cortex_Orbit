import type {
  AskAnswer,
  AtlasPayload,
  Card,
  Citation,
  ConceptDetail,
  Concept,
  ExplainGrade,
  Gap,
  Health,
  LogPayload,
  ReviewItem,
  Source,
} from '@cortex/core';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    let msg = `The server answered ${res.status}.`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* body was not JSON */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () => call<Health>('/health'),
  atlas: () => call<AtlasPayload>('/atlas'),
  concept: (id: number) => call<ConceptDetail>(`/concepts/${id}`),
  updateConcept: (id: number, patch: Partial<Concept>) => call<Concept>(`/concepts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteConcept: (id: number) => call<{ ok: true }>(`/concepts/${id}`, { method: 'DELETE' }),
  mergeConcept: (id: number, into: number) => post<{ ok: true }>(`/concepts/${id}/merge`, { into }),
  moreCards: (id: number) => post<Card[]>(`/concepts/${id}/cards`),
  route: (id: number) => call<{ id: number; catalog: string; name: string; retention: number }[]>(`/concepts/${id}/route`),

  sources: () => call<Source[]>('/sources'),
  source: (id: number) =>
    call<{ source: Source; passages: { id: number; text: string }[]; concepts: Concept[] }>(`/sources/${id}`),
  addUrl: (url: string) => post<Source>('/sources', { url }),
  addNote: (title: string, text: string) => post<Source>('/sources', { title, text }),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return call<Source>('/sources/upload', { method: 'POST', body: fd });
  },
  retry: (id: number) => post<Source>(`/sources/${id}/retry`),
  deleteSource: (id: number) => call<{ ok: true }>(`/sources/${id}`, { method: 'DELETE' }),

  session: (mode: string, concept?: number) =>
    call<{ items: ReviewItem[]; dueTotal: number }>(`/session?mode=${mode}${concept ? `&concept=${concept}` : ''}`),
  review: (cardId: number, grade: number, mode = 'card') => post<Card>('/review', { cardId, grade, mode }),
  explain: (conceptId: number, explanation: string) =>
    post<ExplainGrade & { mode: 'online' | 'offline' }>('/explain', { conceptId, explanation }),

  gaps: () => call<Gap[]>('/gaps'),
  survey: () => post<{ added: number; gaps: Gap[] }>('/gaps/survey'),
  chart: (id: number) => post<{ sourceId: number | null; gaps: Gap[] }>(`/gaps/${id}/chart`),
  dismiss: (id: number) => post<Gap[]>(`/gaps/${id}/dismiss`),

  search: (q: string) =>
    call<{ concepts: { id: number; catalog: string; name: string }[]; passages: { chunkId: number; sourceId: number; accession: string; text: string }[] }>(
      `/search?q=${encodeURIComponent(q)}`,
    ),
  log: () => call<LogPayload>('/log'),
};

/** Streams an answer from the vault. Server-sent events over a POST body. */
export async function ask(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  on: {
    meta: (m: Pick<AskAnswer, 'citations' | 'concepts' | 'mode'>) => void;
    text: (t: string) => void;
    error: (e: string) => void;
  },
  signal?: AbortSignal,
) {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, history }),
    signal,
  });
  if (!res.ok || !res.body) {
    on.error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'The vault did not answer.');
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = raw.match(/^event: (.*)$/m)?.[1];
      const data = raw.match(/^data: (.*)$/m)?.[1];
      if (!event || data == null) continue;
      if (event === 'meta') on.meta(JSON.parse(data) as { citations: Citation[]; concepts: AskAnswer['concepts']; mode: 'online' | 'offline' });
      else if (event === 'text') on.text(JSON.parse(data));
      else if (event === 'error') on.error(JSON.parse(data));
    }
  }
}

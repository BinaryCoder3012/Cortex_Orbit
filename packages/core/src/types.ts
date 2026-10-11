// Shared shapes between the server and the web client.

export type SourceKind = 'url' | 'pdf' | 'note' | 'youtube' | 'github';
export type SourceStatus = 'queued' | 'developing' | 'fixed' | 'failed';

export interface Source {
  id: number;
  accession: string; // ACC-0007
  kind: SourceKind;
  title: string;
  url: string | null;
  status: SourceStatus;
  error: string | null;
  createdAt: string;
  chunkCount: number;
  conceptCount: number;
}

export type ConceptKind = 'idea' | 'technique' | 'tool' | 'term' | 'principle' | 'pattern';

export interface Concept {
  id: number;
  catalog: string; // CO-0042
  name: string;
  summary: string;
  kind: ConceptKind;
  importance: number; // 1..5, drives star magnitude
  aliases: string[];
  createdAt: string;
  sourceIds: number[];
  pinned: boolean;
}

export type EdgeType = 'prerequisite' | 'part_of' | 'related' | 'contrasts';

export interface Edge {
  from: number;
  to: number;
  type: EdgeType;
}

export type CardKind = 'qa' | 'cloze' | 'mcq' | 'explain';

export interface MemoryState {
  ease: number;
  interval: number; // days, doubles as stability in the forgetting curve
  reps: number;
  lapses: number;
  lastReviewAt: string | null;
  dueAt: string;
}

export interface Card extends MemoryState {
  id: number;
  conceptId: number;
  kind: CardKind;
  prompt: string;
  answer: string;
  options: string[] | null; // mcq only
  createdAt: string;
}

export interface Gap {
  id: number;
  name: string;
  summary: string;
  reason: string;
  between: number[]; // concept ids this would bridge
  status: 'open' | 'charted' | 'dismissed';
  createdAt: string;
}

export type MemoryTrace = Pick<Card, 'interval' | 'lastReviewAt' | 'createdAt'>;

/** Everything the atlas needs to draw the plate and run the time dial client-side. */
export interface AtlasPayload {
  concepts: Concept[];
  edges: Edge[];
  memory: Record<number, MemoryTrace[]>;
  gaps: Gap[];
  now: string;
}

export interface Citation {
  n: number;
  sourceId: number;
  accession: string;
  sourceTitle: string;
  chunkId: number;
  excerpt: string;
}

export interface AskAnswer {
  answer: string;
  citations: Citation[];
  concepts: { id: number; catalog: string; name: string }[];
  mode: 'online' | 'offline';
}

export interface ReviewItem {
  card: Card;
  concept: Pick<Concept, 'id' | 'catalog' | 'name' | 'summary'>;
  retention: number;
}

export interface ExplainGrade {
  grade: number; // 0..5
  verdict: string;
  missing: string[];
}

export interface ConceptDetail {
  concept: Concept;
  cards: Card[];
  passages: { chunkId: number; sourceId: number; accession: string; sourceTitle: string; text: string }[];
  neighbours: { id: number; catalog: string; name: string; type: EdgeType; direction: 'out' | 'in' }[];
  history: { at: string; grade: number }[];
}

export interface LogPayload {
  reviews: { day: string; count: number; meanGrade: number }[];
  totals: { concepts: number; cards: number; sources: number; reviews: number; gapsOpen: number };
  forecast: { day: number; meanRetention: number; ghosts: number }[];
  fading: { id: number; catalog: string; name: string; retention: number; fadesInDays: number }[];
}

export interface Health {
  ai: 'online' | 'offline';
  /** Display name of the model provider, e.g. Claude, Gemini, Groq. */
  provider: string | null;
  model: string | null;
}

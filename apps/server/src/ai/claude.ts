import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import { aiEnabled, MODEL, provider } from './provider.ts';
import { CompatError, compatJson, compatStream } from './compat.ts';

export { aiEnabled, MODEL, provider };

const useClaude = provider?.id === 'anthropic';

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

// Server-side fallback: if a safety classifier declines a request, the API
// re-runs it on Anthropic's recommended fallback model inside the same call.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

type Effort = 'low' | 'medium' | 'high';

export class AiError extends Error {}

async function structured<S extends z.ZodType>(
  schema: S,
  system: string,
  user: string,
  effort: Effort,
  maxTokens = 16000,
): Promise<z.infer<S>> {
  try {
    if (!useClaude) return await compatJson(provider!, schema, system, user, Math.min(maxTokens, 8192));
    const res = await anthropic().beta.messages.parse({
      model: MODEL!,
      max_tokens: maxTokens,
      ...FALLBACK,
      thinking: { type: 'adaptive' },
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') throw new AiError('Claude declined to process this material.');
    if (res.stop_reason === 'max_tokens') throw new AiError('The response ran out of room. Try a shorter source.');
    if (!res.parsed_output) throw new AiError('Claude returned something that did not match the expected shape.');
    return res.parsed_output;
  } catch (e) {
    throw translate(e);
  }
}

function translate(e: unknown): Error {
  if (e instanceof AiError) return e;
  if (e instanceof CompatError) return new AiError(e.message);
  if (e instanceof Anthropic.AuthenticationError) return new AiError('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.');
  if (e instanceof Anthropic.RateLimitError) return new AiError('Rate limited by the Anthropic API. Wait a minute and retry.');
  if (e instanceof Anthropic.BadRequestError) return new AiError(`The Anthropic API rejected the request: ${e.message}`);
  if (e instanceof Anthropic.APIError) return new AiError(`Anthropic API error ${e.status ?? ''}: ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

// ── extraction ─────────────────────────────────────────────────────────────

const KIND = z.enum(['idea', 'technique', 'tool', 'term', 'principle', 'pattern']);

export const Extraction = z.object({
  title: z.string().describe('A short, specific title for the source material'),
  concepts: z.array(
    z.object({
      name: z.string().describe('Canonical name, Title Case unless it is code'),
      summary: z.string().describe('One or two plain sentences a learner could memorise'),
      kind: KIND,
      importance: z.number().describe('1 (aside) to 5 (central to the material)'),
      aliases: z.array(z.string()),
    }),
  ),
  relations: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.enum(['prerequisite', 'part_of', 'related', 'contrasts']),
    }),
  ),
  cards: z.array(
    z.object({
      concept: z.string().describe('Exact name of the concept this card tests'),
      kind: z.enum(['qa', 'cloze', 'mcq']),
      prompt: z.string().describe('For cloze, mark the hidden span as {{answer}}'),
      answer: z.string(),
      options: z.array(z.string()).describe('mcq only: four options including the answer; empty otherwise'),
    }),
  ),
});
export type ExtractionT = z.infer<typeof Extraction>;

const EXTRACT_SYSTEM = `You build a learner's personal knowledge atlas. From the source material, pull out the concepts worth remembering, how they relate, and recall cards that test them.

Concepts
- Pick the ideas a learner would want to recall in a month, not every noun. Usually 6–20 per source; fewer for short notes.
- Prefer names a practitioner would search for ("Context API", "Write-Ahead Logging"), not sentence fragments.
- If a concept already exists in the vault (listed below the material), reuse its exact name so the atlas links instead of duplicating.

Relations
- "prerequisite": you must understand FROM before TO makes sense.
- "part_of": FROM is a component or special case of TO.
- "contrasts": commonly confused or opposing approaches.
- "related": meaningful link that is none of the above. Use sparingly.
- Relations may point to vault concepts that are not in this source.

Cards
- Two or three per important concept, mixing kinds. Test understanding, not trivia: why, when, what breaks.
- Answers must be supported by the material. Keep answers under 40 words.
- Cloze prompts hide exactly one key term with {{double braces}}; the answer is that term.
- MCQ distractors must be plausible to someone half-remembering.`;

export async function extract(material: string, title: string, vault: string[]): Promise<ExtractionT> {
  const known = vault.length ? vault.slice(0, 400).join('; ') : '(the vault is empty)';
  return structured(
    Extraction,
    EXTRACT_SYSTEM,
    `<material title="${escapeAttr(title)}">\n${material}\n</material>\n\n<vault_concepts>${known}</vault_concepts>`,
    'medium',
    24000,
  );
}

// ── gap survey ─────────────────────────────────────────────────────────────

const GapSurvey = z.object({
  gaps: z.array(
    z.object({
      name: z.string(),
      summary: z.string().describe('What the missing concept is, in one or two sentences'),
      reason: z.string().describe('Why this learner specifically is missing it, naming the concepts it would connect'),
      between: z.array(z.string()).describe('Exact names of 2–4 existing vault concepts it bridges'),
    }),
  ),
});

export async function surveyGaps(
  concepts: { name: string; summary: string; retention: number }[],
  edges: { from: string; to: string; type: string }[],
  dismissed: string[],
) {
  const list = concepts.map((c) => `- ${c.name} (${Math.round(c.retention * 100)}% recalled): ${c.summary}`).join('\n');
  const links = edges.map((e) => `${e.from} -[${e.type}]-> ${e.to}`).join('\n');
  return structured(
    GapSurvey,
    `You are a tutor reviewing a learner's knowledge map. Find the concepts they are missing that would connect what they already know: bridges between clusters, prerequisites that their concepts assume, and the next idea a practitioner at their level would be expected to know.

Rules
- Return 3–8 gaps, most valuable first. Each must connect at least two concepts the learner already has.
- Never return something already in their map, under any name, or anything in the dismissed list.
- Be specific: "useReducer" beats "React state"; "Two-Phase Locking" beats "concurrency".`,
    `<concepts>\n${list}\n</concepts>\n<links>\n${links || '(none)'}\n</links>\n<dismissed>${dismissed.join('; ') || '(none)'}</dismissed>`,
    'medium',
  );
}

// ── primer for a gap ───────────────────────────────────────────────────────

export async function writePrimer(name: string, summary: string, context: string[]): Promise<string> {
  const P = z.object({ primer: z.string() });
  const out = await structured(
    P,
    `Write a compact study primer (250–450 words, plain prose with short paragraphs, no headings) that teaches one concept to a learner who already knows the related concepts listed. Connect it explicitly to what they know. Be accurate; if a detail is version-specific, say so.`,
    `Concept: ${name}\nWhat it is: ${summary}\nThey already know: ${context.join(', ')}`,
    'medium',
  );
  return out.primer;
}

// ── fresh cards for one concept ────────────────────────────────────────────

const FreshCards = z.object({
  cards: z.array(
    z.object({
      kind: z.enum(['qa', 'cloze', 'mcq']),
      prompt: z.string(),
      answer: z.string(),
      options: z.array(z.string()),
    }),
  ),
});

export async function freshCards(name: string, summary: string, passages: string[], existing: string[]) {
  return structured(
    FreshCards,
    `Write 3 new recall cards for one concept, mixing kinds, grounded in the passages. Do not repeat or rephrase existing prompts. Cloze prompts hide one term with {{double braces}}. MCQ: four options including the answer.`,
    `Concept: ${name}\nSummary: ${summary}\n<passages>\n${passages.join('\n---\n')}\n</passages>\n<existing_prompts>\n${existing.join('\n')}\n</existing_prompts>`,
    'low',
  );
}

// ── explain-back grading ───────────────────────────────────────────────────

const Grade = z.object({
  grade: z.number().describe('0 = blank or wrong, 3 = core idea right with gaps, 5 = complete and precise'),
  verdict: z.string().describe('One or two sentences of direct feedback, addressed to the learner'),
  missing: z.array(z.string()).describe('Specific points they left out or got wrong; empty if none'),
});

export async function gradeExplanation(name: string, summary: string, passages: string[], explanation: string) {
  return structured(
    Grade,
    `You grade a learner's from-memory explanation of a concept against their own source notes. Be fair and specific: reward correct understanding in their own words, penalise errors more than omissions. Never invent facts beyond the notes.`,
    `Concept: ${name}\nReference summary: ${summary}\n<notes>\n${passages.join('\n---\n')}\n</notes>\n<explanation>\n${explanation}\n</explanation>`,
    'low',
    4000,
  );
}

// ── grounded answers ───────────────────────────────────────────────────────

const ASK_SYSTEM = `You answer questions using only the learner's own notes, provided as numbered passages. Cite every claim with the passage number in square brackets, like [2] or [1][4]. If the notes do not cover the question, say so plainly in one sentence and suggest what to add to the vault; do not fill in from general knowledge. Write compact prose; use a short list only when the answer is a sequence.`;

export async function* streamAnswer(question: string, passages: { n: number; title: string; text: string }[], history: { role: 'user' | 'assistant'; content: string }[]) {
  const context = passages.map((p) => `<passage n="${p.n}" source="${escapeAttr(p.title)}">\n${p.text}\n</passage>`).join('\n');
  try {
    if (!useClaude) {
      yield* compatStream(provider!, ASK_SYSTEM, history.slice(-6), `${context}\n\nQuestion: ${question}`);
      return;
    }
    const stream = anthropic().beta.messages.stream({
      model: MODEL!,
      max_tokens: 8000,
      ...FALLBACK,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: ASK_SYSTEM,
      messages: [
        ...history.slice(-6),
        { role: 'user', content: `${context}\n\nQuestion: ${question}` },
      ],
    });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield ev.delta.text;
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') yield '\n\nClaude declined to answer this one.';
  } catch (e) {
    throw translate(e);
  }
}

function escapeAttr(s: string) {
  return s.replace(/"/g, "'").replace(/[<>]/g, '');
}

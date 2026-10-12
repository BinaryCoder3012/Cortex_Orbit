import { z } from 'zod';
import type { Provider } from './provider.ts';

// A small client for OpenAI-compatible chat endpoints (Gemini, OpenRouter,
// Groq, Ollama). No SDK: plain fetch, JSON mode where the provider supports it,
// and every structured reply validated against the same Zod schema Claude uses.

export class CompatError extends Error {}

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

async function post(p: Provider, body: Record<string, unknown>): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}),
        ...p.headers,
      },
      body: JSON.stringify({ model: p.model, ...body }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    if (p.id === 'ollama') throw new CompatError(`Could not reach Ollama at ${p.baseUrl}. Is "ollama serve" running and "${p.model}" pulled?`);
    throw new CompatError(`Could not reach ${p.label}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new CompatError(`${p.label} rejected the API key. Check it in .env.`);
    if (res.status === 429) throw new CompatError(`${p.label} rate limit or free quota reached. Wait a minute and retry, or switch model.`);
    if (res.status === 404) throw new CompatError(`${p.label} does not know the model "${p.model}". Set AI_MODEL in .env.`);
    const err = new CompatError(`${p.label} error ${res.status}: ${detail}`);
    (err as any).status = res.status;
    throw err;
  }
  return res;
}

/** Pulls the first JSON object out of a reply that may wrap it in prose or fences. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const src = fenced ?? text;
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the reply');
  return JSON.parse(src.slice(start, end + 1));
}

export async function compatJson<S extends z.ZodType>(
  p: Provider,
  schema: S,
  system: string,
  user: string,
  maxTokens: number,
): Promise<z.infer<S>> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  const messages: Msg[] = [
    {
      role: 'system',
      content: `${system}\n\nReply with a single JSON object and nothing else. It must validate against this JSON Schema (fill every required field; use [] for empty lists):\n${jsonSchema}`,
    },
    { role: 'user', content: user },
  ];

  let jsonMode = true;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await post(p, {
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      });
    } catch (e) {
      // some models reject JSON mode; retry once without it
      if (jsonMode && (e as any).status === 400) {
        jsonMode = false;
        continue;
      }
      throw e;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (choice?.finish_reason === 'length') throw new CompatError(`${p.label} ran out of room. Try a shorter source or a model with a larger output limit.`);
    try {
      const parsed = schema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data;
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `That JSON did not match the schema: ${parsed.error.message.slice(0, 600)}. Reply again with corrected JSON only.` });
    } catch (e) {
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `That was not valid JSON (${(e as Error).message}). Reply again with the JSON object only.` });
    }
  }
  throw new CompatError(`${p.label} (${p.model}) did not return usable JSON after three tries. Try a larger model via AI_MODEL.`);
}

export async function* compatStream(p: Provider, system: string, history: Msg[], user: string): AsyncGenerator<string> {
  const res = await post(p, {
    stream: true,
    temperature: 0.3,
    max_tokens: 4000,
    messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: user }],
  });
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const piece = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
        if (piece) yield piece;
      } catch {
        /* keep-alive comments and partial frames */
      }
    }
  }
}

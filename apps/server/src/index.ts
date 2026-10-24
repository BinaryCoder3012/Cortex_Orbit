import './env.ts';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app as api } from './app.ts';
import { resumePending } from './pipeline.ts';
import { aiEnabled, MODEL, provider } from './ai/claude.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');
const port = Number(process.env.PORT ?? 8787);

const root = new Hono();
root.route('/', api);

// In production the server also hands out the built atlas.
if (existsSync(webDist)) {
  const rel = path.relative(process.cwd(), webDist).split(path.sep).join('/');
  root.use('/*', serveStatic({ root: rel }));
  root.get('*', serveStatic({ path: `${rel}/index.html` }));
}

// On Vercel the platform imports this module and calls the exported app;
// only a long-running process should open a port.
const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

if (!serverless) serve({ fetch: root.fetch, port }, () => {
  console.log(`CortexOrbit observatory on http://localhost:${port}`);
  console.log(aiEnabled
      ? `  AI: ${provider!.label} · ${MODEL}`
      : '  offline mode: heuristic extraction (add a Claude, Gemini, OpenRouter or Groq key to .env, or set AI_PROVIDER=ollama)');
  resumePending();
});

export default root;

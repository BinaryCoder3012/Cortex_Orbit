import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { extractText, getDocumentProxy } from 'unpdf';
import type { SourceKind } from '@cortex/core';

export interface Fetched {
  title: string;
  text: string;
}

const UA = 'Mozilla/5.0 (CortexOrbit; personal knowledge vault) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const MAX_BYTES = 25 * 1024 * 1024;

export function classifyUrl(url: string): SourceKind {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') return 'youtube';
  if (host === 'github.com' && u.pathname.split('/').filter(Boolean).length >= 2) return 'github';
  if (u.pathname.toLowerCase().endsWith('.pdf')) return 'pdf';
  return 'url';
}

async function get(url: string, accept = '*/*'): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept, 'accept-language': 'en' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`The page answered ${res.status} ${res.statusText}.`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error('That file is larger than 25 MB.');
  return res;
}

export async function fetchSource(kind: SourceKind, url: string): Promise<Fetched> {
  switch (kind) {
    case 'youtube':
      return fetchYouTube(url);
    case 'github':
      return fetchGitHub(url);
    case 'pdf': {
      const res = await get(url, 'application/pdf');
      return pdfToText(new Uint8Array(await res.arrayBuffer()), titleFromUrl(url));
    }
    default:
      return fetchArticle(url);
  }
}

export async function fetchArticle(url: string): Promise<Fetched> {
  const res = await get(url, 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8');
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/pdf')) {
    return pdfToText(new Uint8Array(await res.arrayBuffer()), titleFromUrl(url));
  }
  const html = await res.text();
  if (!type.includes('html')) return { title: titleFromUrl(url), text: html };
  const { document } = parseHTML(html);
  const article = new Readability(document as any).parse();
  const text = (article?.textContent ?? document.body?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 200) throw new Error('Could not find readable text on that page. Try pasting it as a note.');
  return { title: (article?.title || document.title || titleFromUrl(url)).trim(), text };
}

export async function pdfToText(bytes: Uint8Array, fallbackTitle: string): Promise<Fetched> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((p) => p.replace(/[ \t]+/g, ' ').trim());
  const body = pages.join('\n\n').trim();
  if (body.length < 100) throw new Error('This PDF has no extractable text (it may be scanned images).');
  let title = fallbackTitle;
  try {
    const meta = await pdf.getMetadata();
    const t = (meta.info as any)?.Title;
    if (typeof t === 'string' && t.trim().length > 3) title = t.trim();
  } catch {
    /* metadata is optional */
  }
  return { title, text: body };
}

async function fetchGitHub(url: string): Promise<Fetched> {
  const [owner, repo] = new URL(url).pathname.split('/').filter(Boolean);
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = { 'user-agent': UA, accept: 'application/vnd.github+json' };
  const meta = await fetch(api, { headers, signal: AbortSignal.timeout(20_000) });
  if (!meta.ok) throw new Error(`GitHub answered ${meta.status} for ${owner}/${repo}.`);
  const info = (await meta.json()) as { full_name: string; description: string | null; topics?: string[] };
  const readme = await fetch(`${api}/readme`, {
    headers: { ...headers, accept: 'application/vnd.github.raw+json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!readme.ok) throw new Error(`${owner}/${repo} has no README to read.`);
  const md = await readme.text();
  const header = [info.description, info.topics?.length ? `Topics: ${info.topics.join(', ')}` : '']
    .filter(Boolean)
    .join('\n');
  return { title: info.full_name, text: `${header}\n\n${stripMarkdownNoise(md)}`.trim() };
}

async function fetchYouTube(url: string): Promise<Fetched> {
  const u = new URL(url);
  const id = u.hostname.includes('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v');
  if (!id) throw new Error('That YouTube link has no video id.');
  const page = await (await get(`https://www.youtube.com/watch?v=${id}&hl=en`, 'text/html')).text();
  const title = decodeEntities(page.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'YouTube video').replace(/ - YouTube$/, '');
  const tracksJson = page.match(/"captionTracks":(\[.*?\])/)?.[1];
  if (!tracksJson) {
    throw new Error('This video exposes no captions. Paste its transcript as a note instead.');
  }
  const tracks = JSON.parse(tracksJson) as { baseUrl: string; languageCode: string; kind?: string }[];
  const track = tracks.find((t) => t.languageCode.startsWith('en') && t.kind !== 'asr') ??
    tracks.find((t) => t.languageCode.startsWith('en')) ??
    tracks[0];
  const xml = await (await get(track.baseUrl, 'text/xml')).text();
  const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decodeEntities(m[1]).replace(/\s+/g, ' ').trim());
  const text = lines.join(' ').replace(/\s+/g, ' ');
  if (text.length < 200) throw new Error('The captions for this video were empty. Paste its transcript as a note instead.');
  // transcripts have no paragraphs: break roughly every 6 sentences so chunks stay readable
  const sentences = text.split(/(?<=[.?!])\s+/);
  const paras: string[] = [];
  for (let i = 0; i < sentences.length; i += 6) paras.push(sentences.slice(i, i + 6).join(' '));
  return { title, text: paras.join('\n\n') };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripMarkdownNoise(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/<\/?(p|div|a|picture|source|br)[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

function titleFromUrl(url: string): string {
  const u = new URL(url);
  const last = u.pathname.split('/').filter(Boolean).pop();
  return last ? decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') : u.hostname;
}

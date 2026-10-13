import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Source } from '@cortex/core';
import { api } from '../lib/api.ts';
import { relDays, useVault } from '../lib/store.tsx';
import { Icon } from '../components/Icon.tsx';

type Tab = 'link' | 'file' | 'note';

export function AccessionPage() {
  const { refresh, toast, health } = useVault();
  const [tab, setTab] = useState<Tab>('link');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [recent, setRecent] = useState<Source[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.sources().then(setRecent).catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  // poll while anything is developing, then refresh the plate once it settles
  const developing = recent.some((s) => s.status === 'queued' || s.status === 'developing');
  useEffect(() => {
    if (!developing) return;
    const t = window.setInterval(async () => {
      const next = await api.sources().catch(() => null);
      if (!next) return;
      setRecent(next);
      if (!next.some((s) => s.status === 'queued' || s.status === 'developing')) void refresh();
    }, 1500);
    return () => window.clearInterval(t);
  }, [developing, refresh]);

  const submit = async (fn: () => Promise<Source>) => {
    setBusy(true);
    try {
      const s = await fn();
      toast(`${s.accession} received. Reading it now.`);
      setUrl('');
      setText('');
      setTitle('');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void submit(() => api.upload(f));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Accession <em>desk</em>
          </h1>
          <p>
            Hand over anything you learned from: an article, a YouTube lecture, a GitHub repo, a PDF, or your own notes. Each one gets an accession number, and its concepts rise into your sky with recall cards attached.
          </p>
        </div>
      </div>

      <div className="desk">
        <div className="plaque sleeve">
          <div className="head">
            <h2>New accession</h2>
            <span className="mono">{health?.ai === 'online' ? `read by ${health.provider} · ${health.model}` : 'offline reader'}</span>
          </div>
          <div className="seg" role="tablist" aria-label="What are you adding?" style={{ marginBottom: 16 }}>
            {(['link', 'file', 'note'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t === 'link' ? 'Link' : t === 'file' ? 'File' : 'Note'}
              </button>
            ))}
          </div>

          {tab === 'link' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(() => api.addUrl(url.trim()));
              }}
            >
              <label htmlFor="url">Web address</label>
              <input
                id="url"
                className="field"
                type="url"
                required
                placeholder="https://"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
              />
              <p className="hint">Articles and docs are read with Readability. YouTube links use the video's captions, GitHub repos their README, and .pdf links are read as PDFs.</p>
              <div>
                <button className="btn ink" disabled={busy}>
                  {busy ? <span className="spinner" /> : <Icon name="accession" size={16} />} Accession link
                </button>
              </div>
            </form>
          )}

          {tab === 'file' && (
            <div
              className={`drop${over ? ' over' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                onFiles(e.dataTransfer.files);
              }}
            >
              <Icon name="upload" size={26} />
              <b>{busy ? 'Receiving…' : 'Drop a PDF, Markdown or text file'}</b>
              <span className="hint">or click to choose one · up to 25 MB</span>
              <input ref={fileRef} type="file" accept=".pdf,.md,.markdown,.txt,application/pdf,text/*" hidden onChange={(e) => onFiles(e.target.files)} />
            </div>
          )}

          {tab === 'note' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(() => api.addNote(title, text));
              }}
            >
              <label htmlFor="ntitle">Title</label>
              <input id="ntitle" className="field" placeholder="Lecture 7: query planning" value={title} onChange={(e) => setTitle(e.target.value)} />
              <label htmlFor="ntext">Notes or transcript</label>
              <textarea id="ntext" className="field" required minLength={40} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste or write anything: lecture notes, a transcript, a chapter summary. Markdown headings help." style={{ minHeight: 220 }} />
              <div>
                <button className="btn ink" disabled={busy || text.trim().length < 40}>
                  {busy ? <span className="spinner" /> : null} Accession note
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="recent">
          <h2 style={{ fontSize: '1rem', marginBottom: 6 }}>Recently received</h2>
          {recent.length === 0 ? (
            <p className="muted">Nothing yet. The first accession number is waiting.</p>
          ) : (
            <ul>
              {recent.slice(0, 9).map((s) => (
                <li key={s.id}>
                  <span className="t" title={s.title}>
                    <Link to={`/sources?open=${s.id}`} style={{ textDecoration: 'none' }}>{s.title}</Link>
                  </span>
                  <span className={`status ${s.status}`}>{s.status === 'fixed' ? `${s.conceptCount} stars` : s.status}</span>
                  <span className="cat">
                    {s.accession} · {s.kind} · {relDays(s.createdAt)}
                  </span>
                  {s.status === 'failed' ? (
                    <button className="btn quiet small" style={{ justifySelf: 'end' }} onClick={() => api.retry(s.id).then(load)}>
                      <Icon name="retry" size={14} /> Retry
                    </button>
                  ) : (
                    <span />
                  )}
                  {s.error && <span className="err">{s.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

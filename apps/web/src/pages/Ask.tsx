import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AskAnswer } from '@cortex/core';
import { ask } from '../lib/api.ts';
import { useVault } from '../lib/store.tsx';
import { Icon } from '../components/Icon.tsx';

interface Turn {
  q: string;
  a: string;
  meta: Pick<AskAnswer, 'citations' | 'concepts' | 'mode'> | null;
  error?: string;
  done: boolean;
}

export function AskPage() {
  const { atlas, health } = useVault();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState<{ turn: number; n: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = turns.length > 0 && !turns[turns.length - 1].done;

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length]);

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    const history = turns.flatMap((t) => [
      { role: 'user' as const, content: t.q },
      { role: 'assistant' as const, content: t.a },
    ]);
    const idx = turns.length;
    setTurns((t) => [...t, { q: question, a: '', meta: null, done: false }]);
    setQ('');
    const patch = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((t, i) => (i === idx ? fn(t) : t)));
    abort.current = new AbortController();
    try {
      await ask(
        question,
        history,
        {
          meta: (m) => patch((t) => ({ ...t, meta: m })),
          text: (s) => patch((t) => ({ ...t, a: t.a + s })),
          error: (e) => patch((t) => ({ ...t, error: e })),
        },
        abort.current.signal,
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patch((t) => ({ ...t, error: (e as Error).message }));
    }
    patch((t) => ({ ...t, done: true }));
  };

  const suggestions = (atlas?.concepts ?? [])
    .filter((c) => c.importance >= 4)
    .slice(0, 3)
    .map((c) => `How does ${c.name} relate to the rest of what I know?`);
  if (atlas && atlas.concepts.length >= 2) {
    const [a, b] = [...atlas.concepts].sort((x, y) => y.importance - x.importance);
    suggestions.unshift(`What is the difference between ${a.name} and ${b.name}?`);
  }

  const current = focus ? turns[focus.turn]?.meta?.citations : turns[turns.length - 1]?.meta?.citations;
  const focusN = focus?.n ?? null;

  return (
    <div className="page" style={{ maxWidth: 1120 }}>
      <div className="page-head">
        <div>
          <h1>
            Ask the <em>vault</em>
          </h1>
          <p>
            Answers come only from what you have accessioned, with every claim tied to a passage. If your notes don't cover it, it says so instead of guessing.
            {health?.ai === 'offline' && ' Offline, it returns the closest lines from your notes.'}
          </p>
        </div>
      </div>

      <div className="ask">
        <div>
          <div className="thread">
            {turns.length === 0 && (
              <div>
                <p className="muted">Try one of these, or ask your own:</p>
                <div className="suggest">
                  {suggestions.slice(0, 4).map((s) => (
                    <button key={s} className="chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, ti) => (
              <section key={ti} aria-live={ti === turns.length - 1 ? 'polite' : undefined}>
                <div className="q">{t.q}</div>
                <div className="a">
                  {renderCited(t.a, (n) => setFocus({ turn: ti, n }), focus?.turn === ti ? focusN : null)}
                  {!t.done && <span className="caret" />}
                </div>
                {t.error && <p className="err">{t.error}</p>}
                {t.done && t.meta && t.meta.concepts.length > 0 && (
                  <div className="links" style={{ marginTop: 14 }}>
                    {t.meta.concepts.map((c) => (
                      <Link key={c.id} className="chip" to={`/?c=${c.id}`}>
                        <span className="cat">{c.catalog}</span> {c.name}
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            ))}
            <div ref={endRef} />
          </div>
          <form
            className="ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(q);
            }}
          >
            <label className="sr-only" htmlFor="question">Question</label>
            <input
              id="question"
              className="field"
              placeholder="Ask about anything you've accessioned…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <button className="btn ink" disabled={busy || !q.trim()}>
              {busy ? <span className="spinner" /> : <Icon name="ask" size={16} />} Ask
            </button>
          </form>
        </div>

        <aside className="margin" aria-label="Cited passages">
          <h3>Marginalia</h3>
          {!current || current.length === 0 ? (
            <p className="muted" style={{ fontSize: '0.84rem' }}>Cited passages from your sources appear here.</p>
          ) : (
            current.map((c) => (
              <div key={c.chunkId} className={`note${focusN === c.n ? ' on' : ''}`} id={`cite-${c.n}`}>
                <span className="cat">
                  <span>[{c.n}] {c.accession}</span>
                  <Link to={`/sources?open=${c.sourceId}`}>open</Link>
                </span>
                <b style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>{c.sourceTitle}</b>
                {c.excerpt.length > 420 ? `${c.excerpt.slice(0, 420)}…` : c.excerpt}
              </div>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}

function renderCited(text: string, onCite: (n: number) => void, active: number | null): ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[(\d+)\]$/);
    if (!m) return <span key={i}>{p}</span>;
    const n = Number(m[1]);
    return (
      <sup key={i}>
        <button
          className={active === n ? 'on' : undefined}
          onClick={() => {
            onCite(n);
            document.getElementById(`cite-${n}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }}
          aria-label={`Show passage ${n}`}
        >
          {n}
        </button>
      </sup>
    );
  });
}

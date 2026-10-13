import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { conceptRetention, GRADES, sm2, type Card, type ExplainGrade, type ReviewItem } from '@cortex/core';
import { api } from '../lib/api.ts';
import { useVault } from '../lib/store.tsx';
import { StepWedge } from '../components/StepWedge.tsx';

type Mode = 'due' | 'fading' | 'concept' | 'explain';

export function SessionPage() {
  const [params, setParams] = useSearchParams();
  const mode = (params.get('mode') as Mode) || 'due';
  const conceptId = params.get('concept') ? Number(params.get('concept')) : undefined;
  const { refresh, due, atlas } = useVault();

  const setMode = (m: Mode) => setParams(m === 'due' ? {} : { mode: m }, { replace: true });

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>
            Observing <em>session</em>
          </h1>
          <p>Each card you recall relights its star. Answer from memory first, then grade yourself honestly; the schedule is only as good as the grades.</p>
        </div>
        <div className="seg" role="group" aria-label="Session type">
          <button aria-pressed={mode === 'due' || mode === 'concept'} onClick={() => setMode('due')}>
            Due {due}
          </button>
          <button aria-pressed={mode === 'fading'} onClick={() => setMode('fading')}>
            Fading
          </button>
          <button aria-pressed={mode === 'explain'} onClick={() => setMode('explain')}>
            Explain back
          </button>
        </div>
      </div>
      {mode === 'explain' ? (
        <ExplainRun key={`explain-${conceptId ?? ''}`} conceptId={conceptId} atlas={atlas} onDone={refresh} />
      ) : (
        <CardRun key={`${mode}-${conceptId ?? ''}`} mode={mode} conceptId={conceptId} onDone={refresh} />
      )}
    </div>
  );
}

// ── card review ────────────────────────────────────────────────────────────

function CardRun({ mode, conceptId, onDone }: { mode: Mode; conceptId?: number; onDone: () => void }) {
  const { toast } = useVault();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<{ grade: number; name: string }[]>([]);

  useEffect(() => {
    api
      .session(mode, conceptId)
      .then((r) => setItems(r.items))
      .catch((e) => toast(e.message, true));
  }, [mode, conceptId, toast]);

  const grade = useCallback(
    async (card: Card, g: number, name: string) => {
      try {
        await api.review(card.id, g);
        setResults((r) => [...r, { grade: g, name }]);
        setI((x) => x + 1);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), true);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (items && i >= items.length && items.length > 0) onDone();
  }, [i, items, onDone]);

  if (!items) return <span className="spinner" aria-label="Loading cards" />;

  if (items.length === 0) {
    return (
      <div className="empty">
        <h2>{mode === 'fading' ? 'Nothing is fading.' : 'Nothing is due.'}</h2>
        <p>
          {mode === 'fading'
            ? 'Every star is above two-thirds recall. Come back tomorrow, or drag the sundial forward to see what dims next.'
            : 'Your schedule is clear. Reviewing early wastes effort; the spacing is what makes memories stick.'}
        </p>
        <div className="actions">
          <Link className="btn sun" to="/">Back to your sky</Link>
          {mode !== 'fading' && <Link className="btn" to="/session?mode=fading">Check fading stars</Link>}
        </div>
      </div>
    );
  }

  if (i >= items.length) {
    const lapses = results.filter((r) => r.grade < 3).length;
    const lapsed = [...new Set(results.filter((r) => r.grade < 3).map((r) => r.name))];
    return (
      <div className="empty">
        <h2>
          Session <em>done</em>.
        </h2>
        <p>
          {results.length} card{results.length === 1 ? '' : 's'} reviewed across {new Set(results.map((r) => r.name)).size} objects.{' '}
          {lapses === 0
            ? 'No lapses. Their next reviews are now spaced further out.'
            : `${lapses} lapse${lapses === 1 ? '' : 's'} (${lapsed.join(', ')}); those return tomorrow.`}
        </p>
        <div className="actions">
          <Link className="btn sun" to="/">See your sky</Link>
          <Link className="btn" to="/session?mode=explain">Explain one back</Link>
        </div>
      </div>
    );
  }

  const item = items[i];
  return (
    <>
      <div className="session-meta">
        <span className="mono">
          {i + 1} / {items.length}
        </span>
        <div className="progress" aria-hidden="true">
          {items.map((_, k) => (
            <i key={k} className={k < results.length ? (results[k].grade < 3 ? 'lapse' : 'done') : undefined} />
          ))}
        </div>
        <span className="mono muted">space reveals · 1–4 grades</span>
      </div>
      <IndexCard key={item.card.id} item={item} onGrade={(g) => grade(item.card, g, item.concept.name)} />
    </>
  );
}

function IndexCard({ item, onGrade }: { item: ReviewItem; onGrade: (g: number) => void }) {
  const { card, concept, retention } = item;
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [guess, setGuess] = useState('');
  const guessRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    if (!card.options) return null;
    // deterministic shuffle so the answer is not always first
    return [...card.options].sort((a, b) => hashStr(a + card.id) - hashStr(b + card.id));
  }, [card]);

  const intervals = useMemo(() => {
    const now = new Date();
    return Object.fromEntries(Object.entries(GRADES).map(([k, g]) => [k, sm2(card, g, now).interval])) as Record<keyof typeof GRADES, number>;
  }, [card]);

  const correct = picked != null && picked.trim().toLowerCase() === card.answer.trim().toLowerCase();
  const suggested = options ? (picked == null ? null : correct ? 'good' : 'again') : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.key !== 'Enter')) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        const g = [GRADES.again, GRADES.hard, GRADES.good, GRADES.easy][Number(e.key) - 1];
        onGrade(g);
      }
      if (!revealed && options && /^[a-d]$/.test(e.key)) {
        const o = options['abcd'.indexOf(e.key)];
        if (o) {
          setPicked(o);
          setRevealed(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, options, onGrade]);

  const cloze = card.kind === 'cloze';
  const parts = cloze ? card.prompt.split(/\{\{(.+?)\}\}/) : null;

  return (
    <article className="index-card" aria-live="polite">
      <div className="card-top">
        <span>
          <span className="cat">{concept.catalog}</span> <b>{concept.name}</b>
        </span>
        <span title={`Recall ${Math.round(retention * 100)}%`}>
          <StepWedge value={retention} />
        </span>
      </div>

      <div className="prompt">
        {parts
          ? parts.map((p, k) =>
              k % 2 === 1 ? (
                <span key={k} className={revealed ? 'filled' : 'blank'}>
                  {revealed ? p : p.replace(/./g, ' ')}
                </span>
              ) : (
                <span key={k}>{p}</span>
              ),
            )
          : card.prompt}
      </div>

      {cloze && !revealed && (
        <form
          style={{ marginTop: 24, display: 'flex', gap: 8, maxWidth: 420 }}
          onSubmit={(e) => {
            e.preventDefault();
            setPicked(guess);
            setRevealed(true);
          }}
        >
          <label className="sr-only" htmlFor="guess">Your answer</label>
          <input id="guess" ref={guessRef} className="field" placeholder="Type the missing term (optional)" value={guess} onChange={(e) => setGuess(e.target.value)} />
          <button className="btn">Check</button>
        </form>
      )}

      {options && (
        <div className="options">
          {options.map((o, k) => {
            const isAnswer = o === card.answer;
            const cls = revealed ? (isAnswer ? 'right' : o === picked ? 'wrong' : '') : '';
            return (
              <button
                key={o}
                className={cls}
                disabled={revealed}
                onClick={() => {
                  setPicked(o);
                  setRevealed(true);
                }}
              >
                <span className="mono">{'abcd'[k]}</span> {o}
              </button>
            );
          })}
        </div>
      )}

      {revealed && !options && (
        <div className="answer">
          {cloze && picked ? (
            <p className="muted" style={{ marginBottom: 6, fontSize: '0.9rem' }}>
              You wrote “{picked}”. {correct ? 'That matches.' : 'Compare it with the card.'}
            </p>
          ) : null}
          {cloze ? <span>Answer: <b>{card.answer}</b></span> : card.answer}
        </div>
      )}

      {!revealed && !options && (
        <div style={{ marginTop: 'auto', paddingTop: 24 }}>
          <button className="btn ink" onClick={() => setRevealed(true)}>
            Reveal the answer <kbd>space</kbd>
          </button>
        </div>
      )}

      {revealed && (
        <div className="grades" role="group" aria-label="How well did you recall it?">
          {(
            [
              ['again', 'Forgot', 1],
              ['hard', 'Hard', 2],
              ['good', 'Recalled', 3],
              ['easy', 'Easy', 4],
            ] as const
          ).map(([k, label, key]) => (
            <button
              key={k}
              className={k}
              onClick={() => onGrade(GRADES[k])}
              style={suggested === k ? { borderColor: 'var(--ink)', boxShadow: 'var(--shadow)' } : undefined}
            >
              {label}
              <span className="mono">
                {key} · {fmtInterval(intervals[k])}
              </span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

// ── explain back (Feynman) ─────────────────────────────────────────────────

function ExplainRun({ conceptId, atlas, onDone }: { conceptId?: number; atlas: ReturnType<typeof useVault>['atlas']; onDone: () => void }) {
  const { toast, health } = useVault();
  const queue = useMemo(() => {
    if (!atlas) return [];
    if (conceptId) return atlas.concepts.filter((c) => c.id === conceptId);
    const now = new Date(atlas.now);
    return [...atlas.concepts]
      .map((c) => ({ c, r: conceptRetention(atlas.memory[c.id] ?? [], c.createdAt, now) }))
      .filter((x) => x.r < 0.8)
      .sort((a, b) => b.c.importance - a.c.importance || a.r - b.r)
      .slice(0, 5)
      .map((x) => x.c);
  }, [atlas, conceptId]);
  const [i, setI] = useState(0);
  const [text, setText] = useState('');
  const [result, setResult] = useState<(ExplainGrade & { mode: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  if (!atlas) return <span className="spinner" />;
  if (queue.length === 0 || i >= queue.length) {
    return (
      <div className="empty">
        <h2>{queue.length === 0 ? 'Nothing needs explaining.' : 'All explained.'}</h2>
        <p>Explaining from memory is the strongest review there is: it exercises every card on the concept at once.</p>
        <Link className="btn sun" to="/">Back to your sky</Link>
      </div>
    );
  }
  const c = queue[i];

  return (
    <article className="index-card">
      <div className="card-top">
        <span>
          <span className="cat">{c.catalog}</span> <b>Explain it back</b>
        </span>
        <span className="mono muted">
          {i + 1} / {queue.length}
        </span>
      </div>
      <div className="prompt">Explain {c.name} to someone who has never heard of it.</div>
      {!result ? (
        <form
          style={{ marginTop: 24, display: 'grid', gap: 12 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              setResult(await api.explain(c.id, text));
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="sr-only" htmlFor="explain">Your explanation</label>
          <textarea
            id="explain"
            className="field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What it is, why it exists, when you would reach for it…"
            autoFocus
            style={{ background: 'transparent' }}
          />
          <div className="actions">
            <button className="btn ink" disabled={busy || text.trim().length < 15}>
              {busy ? <span className="spinner" /> : null} Grade against my notes
            </button>
            <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>
              {health?.ai === 'online' ? `${health.provider} compares it with your sources.` : 'Offline: graded by overlap with your notes.'}
            </span>
          </div>
        </form>
      ) : (
        <div className="answer">
          <div className="recall-line" style={{ marginBottom: 10 }}>
            <StepWedge value={result.grade / 5} label="Grade" />
            <b>{result.grade} of 5</b>
          </div>
          <p>{result.verdict}</p>
          {result.missing.length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--ink-2)' }}>
              {result.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ marginTop: 14, fontSize: '0.88rem' }}>
            Reference: {c.summary}
          </p>
          <div className="actions" style={{ marginTop: 18 }}>
            <button
              className="btn ink"
              autoFocus
              onClick={() => {
                setResult(null);
                setText('');
                setI(i + 1);
                onDone();
              }}
            >
              Next object
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function fmtInterval(d: number) {
  if (d < 1.5) return '1d';
  if (d < 45) return `${Math.round(d)}d`;
  return `${Math.round(d / 30)}mo`;
}

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

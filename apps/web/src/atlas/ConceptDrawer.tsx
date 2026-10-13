import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { conceptRetention, daysUntilFade, type ConceptDetail, type EdgeType } from '@cortex/core';
import { api } from '../lib/api.ts';
import { fmtDays, relDays, useVault } from '../lib/store.tsx';
import { Icon } from '../components/Icon.tsx';
import { StepWedge } from '../components/StepWedge.tsx';

const EDGE_WORDS: Record<EdgeType, [out: string, inc: string]> = {
  prerequisite: ['unlocks', 'needs'],
  part_of: ['part of', 'contains'],
  related: ['related', 'related'],
  contrasts: ['contrasts with', 'contrasts with'],
};

export function ConceptDrawer({ id, onClose, onSelect }: { id: number; onClose: () => void; onSelect: (id: number) => void }) {
  const { refresh, toast, health, atlas } = useVault();
  const nav = useNavigate();
  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const [route, setRoute] = useState<{ id: number; catalog: string; name: string; retention: number }[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = () => api.concept(id).then(setDetail).catch((e) => toast(e.message, true));
  useEffect(() => {
    setDetail(null);
    setRoute(null);
    setEditing(false);
    setConfirmDelete(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const recall = useMemo(() => {
    if (!detail) return null;
    const now = new Date();
    const traces = detail.cards.map((c) => ({ interval: c.interval, lastReviewAt: c.lastReviewAt, createdAt: c.createdAt }));
    return {
      now: conceptRetention(traces, detail.concept.createdAt, now),
      fades: daysUntilFade(traces, detail.concept.createdAt, now),
    };
  }, [detail]);

  if (!detail || !recall) {
    return (
      <aside className="drawer" aria-busy="true" aria-label="Concept">
        <div className="drawer-head">
          <span className="spinner" />
        </div>
      </aside>
    );
  }

  const { concept, passages, neighbours, history, cards } = detail;
  const names = [concept.name, ...concept.aliases];

  const act = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="drawer" aria-label={`${concept.name}, ${concept.catalog}`}>
      <div className="drawer-head">
        <div className="top">
          <span className="cat">
            {concept.catalog} · {concept.kind} · magnitude {concept.importance}
          </span>
          <button className="btn quiet small" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        {editing ? (
          <EditForm
            detail={detail}
            onDone={async (patch) => {
              if (patch) {
                await act('save', () => api.updateConcept(id, patch), 'Catalogue entry updated.');
                await Promise.all([load(), refresh()]);
              }
              setEditing(false);
            }}
          />
        ) : (
          <h2>{concept.name}</h2>
        )}
      </div>

      <div className="drawer-body">
        {!editing && <p>{concept.summary}</p>}

        <section>
          <h3>Recall</h3>
          <div className="recall-line">
            <StepWedge value={recall.now} large />
            <span className="pct">{Math.round(recall.now * 100)}%</span>
            <span className="muted" style={{ fontSize: '0.84rem' }}>
              {recall.now < 0.5 ? 'Already below half. Review it today.' : `Falls below half ${fmtDays(recall.fades)}.`}
            </span>
          </div>
          {history.length > 0 && (
            <div className="history" style={{ marginTop: 10 }} aria-label={`${history.length} reviews`}>
              {[...history].reverse().map((h, i) => (
                <i key={i} className={h.grade < 3 ? 'lapse' : h.grade === 3 ? 'hard' : undefined} title={`${relDays(h.at)}: grade ${h.grade}`} />
              ))}
            </div>
          )}
        </section>

        <div className="actions">
          <button className="btn sun" onClick={() => nav(`/session?mode=concept&concept=${id}`)} disabled={cards.length === 0}>
            Review {cards.length} card{cards.length === 1 ? '' : 's'}
          </button>
          <button className="btn" onClick={() => nav(`/session?mode=explain&concept=${id}`)}>
            Explain it back
          </button>
          {health?.ai === 'online' && (
            <button
              className="btn"
              disabled={!!busy}
              onClick={() => act('cards', async () => setDetail({ ...detail, cards: await api.moreCards(id) }), 'Three new cards written.')}
            >
              {busy === 'cards' ? <span className="spinner" /> : <Icon name="spark" size={16} />} More cards
            </button>
          )}
        </div>

        {neighbours.length > 0 && (
          <section>
            <h3>Linked stars</h3>
            <div className="links">
              {neighbours.map((n) => (
                <button key={`${n.id}-${n.type}-${n.direction}`} className="chip" onClick={() => onSelect(n.id)}>
                  <span className="muted">{EDGE_WORDS[n.type][n.direction === 'out' ? 0 : 1]}</span> {n.name}
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3>Route here</h3>
          {route ? (
            route.length <= 1 ? (
              <p className="muted" style={{ fontSize: '0.86rem' }}>Nothing needs to come first. This is a starting point.</p>
            ) : (
              <ol className="route">
                {route.map((r) => (
                  <li key={r.id} className={r.retention < 0.5 ? 'weak' : undefined}>
                    <span />
                    <button className="chip" style={{ justifySelf: 'start' }} onClick={() => onSelect(r.id)}>
                      {r.name}
                    </button>
                    <span className="cat">{Math.round(r.retention * 100)}%</span>
                  </li>
                ))}
              </ol>
            )
          ) : (
            <button className="btn small" onClick={() => api.route(id).then(setRoute).catch((e) => toast(e.message, true))}>
              <Icon name="route" size={16} /> Trace prerequisites
            </button>
          )}
        </section>

        <section>
          <h3>From your sources</h3>
          {passages.length === 0 && <p className="muted">No passages linked yet.</p>}
          {passages.map((p) => (
            <div className="passage" key={p.chunkId}>
              <Link to={`/sources?open=${p.sourceId}`} className="cat">
                {p.accession} · {p.sourceTitle}
              </Link>
              {highlight(trimAround(p.text, names), names)}
            </div>
          ))}
        </section>

        <section>
          <h3>Catalogue entry</h3>
          {concept.aliases.length > 0 && (
            <p className="muted" style={{ fontSize: '0.84rem', marginBottom: 10 }}>
              Also known as {concept.aliases.join(', ')}
            </p>
          )}
          <div className="actions">
            <button className="btn small" onClick={() => setEditing(true)}>
              <Icon name="pencil" size={15} /> Edit
            </button>
            <MergeInto
              id={id}
              options={(atlas?.concepts ?? []).filter((c) => c.id !== id).map((c) => ({ id: c.id, label: `${c.name} (${c.catalog})` }))}
              onMerge={(into) =>
                act('merge', async () => {
                  await api.mergeConcept(id, into);
                  await refresh();
                  onSelect(into);
                }, 'Merged. The cards and links moved with it.')
              }
            />
            {confirmDelete ? (
              <button
                className="btn small danger"
                onClick={() =>
                  act('delete', async () => {
                    await api.deleteConcept(id);
                    await refresh();
                    onClose();
                  }, `${concept.name} removed from your sky.`)
                }
              >
                Remove {cards.length} cards for good
              </button>
            ) : (
              <button className="btn small quiet" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={15} /> Remove
              </button>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

function EditForm({ detail, onDone }: { detail: ConceptDetail; onDone: (patch: { name: string; summary: string; importance: number } | null) => void }) {
  const [name, setName] = useState(detail.concept.name);
  const [summary, setSummary] = useState(detail.concept.summary);
  const [importance, setImportance] = useState(detail.concept.importance);
  return (
    <form
      style={{ display: 'grid', gap: 10, marginTop: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        onDone({ name: name.trim(), summary: summary.trim(), importance });
      }}
    >
      <label className="sr-only" htmlFor="edit-name">Name</label>
      <input id="edit-name" className="field" value={name} onChange={(e) => setName(e.target.value)} required />
      <label className="sr-only" htmlFor="edit-summary">Summary</label>
      <textarea id="edit-summary" className="field" value={summary} onChange={(e) => setSummary(e.target.value)} style={{ minHeight: 90 }} />
      <label style={{ fontSize: '0.84rem', display: 'flex', gap: 10, alignItems: 'center' }}>
        Magnitude
        <input type="range" min={1} max={5} value={importance} onChange={(e) => setImportance(Number(e.target.value))} />
        <span className="mono">{importance}</span>
      </label>
      <div className="actions">
        <button className="btn ink small" type="submit">Save entry</button>
        <button className="btn quiet small" type="button" onClick={() => onDone(null)}>Cancel</button>
      </div>
    </form>
  );
}

function MergeInto({ id, options, onMerge }: { id: number; options: { id: number; label: string }[]; onMerge: (into: number) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open) {
    return (
      <button className="btn small" onClick={() => setOpen(true)}>
        Merge into…
      </button>
    );
  }
  const match = options.find((o) => o.label === value);
  return (
    <form
      style={{ display: 'flex', gap: 6, width: '100%' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (match) onMerge(match.id);
      }}
    >
      <input
        className="field"
        list={`merge-${id}`}
        placeholder="Duplicate of…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        aria-label="Concept to merge into"
      />
      <datalist id={`merge-${id}`}>
        {options.map((o) => (
          <option key={o.id} value={o.label} />
        ))}
      </datalist>
      <button className="btn small ink" disabled={!match}>Merge</button>
    </form>
  );
}

function trimAround(raw: string, names: string[], span = 340): string {
  const text = raw.replace(/^#{1,6}\s+/gm, '');
  if (text.length <= span) return text;
  const lower = text.toLowerCase();
  const at = Math.min(...names.map((n) => lower.indexOf(n.toLowerCase())).filter((i) => i >= 0), Infinity);
  if (!Number.isFinite(at)) return `${text.slice(0, span)}…`;
  const start = Math.max(0, at - span / 3);
  return `${start > 0 ? '…' : ''}${text.slice(start, start + span)}${start + span < text.length ? '…' : ''}`;
}

function highlight(text: string, names: string[]): ReactNode {
  const re = new RegExp(`(${names.filter((n) => n.length > 2).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  if (re.source === '()') return text;
  return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

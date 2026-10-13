import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { conceptRetention } from '@cortex/core';
import { useVault } from '../lib/store.tsx';
import { Icon } from '../components/Icon.tsx';
import { PlateCanvas, type PlateFilter } from './PlateCanvas.tsx';
import { ExposureDial } from './ExposureDial.tsx';
import { ConceptDrawer } from './ConceptDrawer.tsx';

export function AtlasPage() {
  const { atlas, refresh, toast } = useVault();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const selected = params.get('c') ? Number(params.get('c')) : null;
  const [offset, setOffset] = useState(() => Math.max(-30, Math.min(60, Number(params.get('t')) || 0)));
  const [filter, setFilter] = useState<PlateFilter>('all');
  const [query, setQuery] = useState('');
  const [seeding, setSeeding] = useState(false);

  const select = useCallback(
    (id: number | null) => {
      const next = new URLSearchParams(params);
      if (id == null) next.delete('c');
      else next.set('c', String(id));
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !atlas) return null;
    return new Set(
      atlas.concepts
        .filter((c) => c.name.toLowerCase().includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q)) || c.catalog.toLowerCase().includes(q))
        .map((c) => c.id),
    );
  }, [query, atlas]);

  const counts = useMemo(() => {
    if (!atlas) return { fading: 0, ghosts: 0, sources: 0 };
    const now = new Date(atlas.now);
    let fading = 0;
    let ghosts = 0;
    for (const c of atlas.concepts) {
      const r = conceptRetention(atlas.memory[c.id] ?? [], c.createdAt, now);
      if (r < 0.65) fading++;
      if (r < 0.4) ghosts++;
    }
    const sources = new Set(atlas.concepts.flatMap((c) => c.sourceIds)).size;
    return { fading, ghosts, sources };
  }, [atlas]);

  if (!atlas) {
    return (
      <div className="atlas">
        <div className="plate" aria-busy="true" />
      </div>
    );
  }

  if (atlas.concepts.length === 0) {
    return (
      <div className="atlas">
        <div className="plate" style={{ display: 'grid', placeItems: 'center' }}>
                    <div className="plaque" style={{ padding: '30px 32px', maxWidth: 460 }}>
            <h2 style={{ fontSize: '2.2rem' }}>
              An empty <em>sky</em>
            </h2>
            <p style={{ margin: '12px 0 22px', color: 'var(--ink-2)' }}>
              Nothing is catalogued yet. Accession a link, PDF or note and its concepts rise here as stars. They glow while you remember them and wear away to bare outlines as you forget.
            </p>
            <div className="actions">
              <Link to="/accession" className="btn sun">
                Accession a source
              </Link>
              <button
                className="btn"
                disabled={seeding}
                onClick={async () => {
                  setSeeding(true);
                  try {
                    await fetch('/api/sample', { method: 'POST' }).then((r) => (r.ok ? r : Promise.reject(new Error('Could not develop the sample plate.'))));
                    await refresh();
                  } catch (e) {
                    toast(e instanceof Error ? e.message : String(e), true);
                  } finally {
                    setSeeding(false);
                  }
                }}
              >
                {seeding ? <span className="spinner" /> : null} Load the sample sky
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const openGaps = atlas.gaps.length;

  return (
    <div className="atlas">
      <div className={`plate${selected != null ? ' has-drawer' : ''}`}>
        <PlateCanvas
          atlas={atlas}
          offsetDays={offset}
          selected={selected}
          filter={filter}
          matches={matches}
          drawerOpen={selected != null}
          onSelect={select}
          onSelectGap={() => nav('/gaps')}
        />
        
        <div className="plate-top">
          <div className="finder">
            <Icon name="search" size={16} />
            <label className="sr-only" htmlFor="finder">Find a star</label>
            <input
              id="finder"
              className="field"
              placeholder="Find a star…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches && matches.size > 0) select([...matches][0]);
                if (e.key === 'Escape') setQuery('');
              }}
            />
            {!query && <kbd>/</kbd>}
          </div>
          <div className="seg" role="group" aria-label="Show">
            {(['all', 'fading', 'gaps'] as const).map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Whole sky' : f === 'fading' ? `Fading ${counts.fading}` : `Gaps ${openGaps}`}
              </button>
            ))}
          </div>
        </div>

        {selected == null && <Legend />}

        <div className="plaque plate-label">
          <div className="row">
            <h2>
              Your <em>sky</em>
            </h2>
            <span className="mono">{new Date(atlas.now).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
          <dl className="lines">
            <dt>STARS</dt>
            <dd>
              <b>{atlas.concepts.length}</b> from {counts.sources} source{counts.sources === 1 ? '' : 's'}
            </dd>
            <dt>FAINT</dt>
            <dd>
              <b>{counts.fading}</b> fading, {counts.ghosts} ghost{counts.ghosts === 1 ? '' : 's'}
            </dd>
            <dt>GAPS</dt>
            <dd>
              <b>{openGaps}</b> circled, not yet charted
            </dd>
          </dl>
          {counts.fading > 0 ? (
            <Link className="btn sun" to="/session?mode=fading">
              Relight {counts.fading} fading star{counts.fading === 1 ? '' : 's'}
            </Link>
          ) : (
            <Link className="btn" to="/accession">
              Accession something new
            </Link>
          )}
        </div>

        <ExposureDial atlas={atlas} value={offset} onChange={setOffset} />

        {selected != null && <ConceptDrawer id={selected} onClose={() => select(null)} onSelect={select} />}

        <ul className="sr-only" aria-label="Objects on the plate">
          {atlas.concepts.map((c) => (
            <li key={c.id}>
              <button onClick={() => select(c.id)}>
                {c.catalog} {c.name}, recall {Math.round(conceptRetention(atlas.memory[c.id] ?? [], c.createdAt, new Date(atlas.now)) * 100)} percent
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}


function Legend() {
  return (
    <div className="legend" aria-label="How to read the plate">
      <div>
        <svg width="18" height="14" aria-hidden="true">
          <circle cx="9" cy="7" r="6.5" fill="var(--saffron)" opacity="0.4" />
          <circle cx="9" cy="7" r="3.6" fill="var(--ink)" />
        </svg>
        Glowing: well remembered
      </div>
      <div>
        <svg width="18" height="14" aria-hidden="true">
          <circle cx="9" cy="7" r="2.4" fill="var(--ink)" opacity="0.45" />
        </svg>
        Pale: fading
      </div>
      <div>
        <svg width="18" height="14" aria-hidden="true">
          <circle cx="9" cy="7" r="4" fill="none" stroke="var(--ink-2)" strokeDasharray="2 2" />
        </svg>
        Bare outline: forgotten
      </div>
      <div>
        <svg width="18" height="14" aria-hidden="true">
          <path d="M9 1.5c3.8 0 7 2.2 6.8 5.4-.2 3.3-3.4 5.4-7.1 5.2C5 12 2.2 9.8 2.4 6.8 2.6 4 5.4 2 9.4 2.2" fill="none" stroke="var(--vermilion)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Circled: a gap to fill
      </div>
    </div>
  );
}


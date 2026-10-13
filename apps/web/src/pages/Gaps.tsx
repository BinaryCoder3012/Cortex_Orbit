import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Gap } from '@cortex/core';
import { api } from '../lib/api.ts';
import { useVault } from '../lib/store.tsx';
import { GreaseRing } from '../components/GreaseRing.tsx';

export function GapsPage() {
  const { atlas, refresh, toast, health } = useVault();
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [busy, setBusy] = useState<number | 'survey' | null>(null);
  const names = useMemo(() => new Map((atlas?.concepts ?? []).map((c) => [c.id, c.name])), [atlas]);

  useEffect(() => {
    api.gaps().then(setGaps).catch((e) => toast(e.message, true));
  }, [toast]);

  const open = gaps?.filter((g) => g.status === 'open') ?? [];
  const charted = gaps?.filter((g) => g.status === 'charted') ?? [];

  const survey = async () => {
    setBusy('survey');
    try {
      const r = await api.survey();
      setGaps(r.gaps);
      toast(r.added ? `Circled ${r.added} new gap${r.added === 1 ? '' : 's'}.` : 'No new gaps found. Your sky hangs together.');
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Gaps in your <em>sky</em>
          </h1>
          <p>
            Concepts your knowledge implies but doesn't hold yet: the bridges between stars you already have. Each stays circled in vermilion until you chart it.
          </p>
        </div>
        <button className="btn ink" onClick={survey} disabled={busy === 'survey' || (atlas?.concepts.length ?? 0) < 3}>
          {busy === 'survey' ? <span className="spinner" /> : null} Survey my sky
        </button>
      </div>

      {gaps === null ? (
        <span className="spinner" />
      ) : open.length === 0 ? (
        <div className="empty">
          <h2>No open circles.</h2>
          <p>
            {health?.ai === 'online'
              ? `Survey your sky and ${health.provider} will look for the concepts that connect your clusters.`
              : 'Offline, the survey looks for terms your sources keep using but never explain. With an AI key, it finds conceptual bridges.'}
          </p>
        </div>
      ) : (
        <div className="gaps">
          {open.map((g) => (
            <article className="gap" key={g.id}>
              <div className="name">
                <span className="circled">
                  <GreaseRing seed={g.id} />
                  {g.name}?
                </span>
              </div>
              <p>{g.summary}</p>
              <p className="why">{g.reason}</p>
              {g.between.length > 0 && (
                <div className="links">
                  {g.between.map((id) =>
                    names.has(id) ? (
                      <Link key={id} className="chip" to={`/?c=${id}`}>
                        {names.get(id)}
                      </Link>
                    ) : null,
                  )}
                </div>
              )}
              <div className="actions">
                <button
                  className="btn small ink"
                  disabled={busy != null}
                  onClick={async () => {
                    setBusy(g.id);
                    try {
                      const r = await api.chart(g.id);
                      setGaps(r.gaps);
                      toast(r.sourceId ? `Primer written and accessioned. ${g.name} is being read.` : `${g.name} catalogued.`);
                      await refresh();
                    } catch (e) {
                      toast(e instanceof Error ? e.message : String(e), true);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === g.id ? <span className="spinner" /> : null} {health?.ai === 'online' ? 'Chart it with a primer' : 'Catalogue it'}
                </button>
                <button
                  className="btn small quiet"
                  disabled={busy != null}
                  onClick={async () => setGaps(await api.dismiss(g.id))}
                >
                  Not for me
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {charted.length > 0 && (
        <>
          <h2 style={{ margin: '56px 0 16px', fontSize: '1rem' }}>Charted since</h2>
          <div className="links">
            {charted.map((g) => (
              <span key={g.id} className="chip" style={{ borderColor: 'var(--indigo)', color: 'var(--indigo)' }}>
                {g.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

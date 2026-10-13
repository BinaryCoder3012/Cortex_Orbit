import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Concept, Source } from '@cortex/core';
import { api } from '../lib/api.ts';
import { relDays, useVault } from '../lib/store.tsx';
import { Icon } from '../components/Icon.tsx';

export function SourcesPage() {
  const { refresh, toast } = useVault();
  const [params, setParams] = useSearchParams();
  const openId = params.get('open') ? Number(params.get('open')) : null;
  const [sources, setSources] = useState<Source[] | null>(null);
  const [detail, setDetail] = useState<{ passages: { id: number; text: string }[]; concepts: Concept[] } | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);

  const load = () => api.sources().then(setSources).catch((e) => toast(e.message, true));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDetail(null);
    if (openId) api.source(openId).then(setDetail).catch((e) => toast(e.message, true));
  }, [openId, toast]);

  const toggle = (id: number) => setParams(openId === id ? {} : { open: String(id) }, { replace: true });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Source <em>ledger</em>
          </h1>
          <p>Every accession, what it was, and what it put in your sky. Removing a source also removes the objects that only it vouched for.</p>
        </div>
        <div className="actions">
          <a className="btn" href="/api/export/anki" download>
            Export to Anki
          </a>
          <a className="btn" href="/api/export/markdown" download>
            Export Markdown
          </a>
          <Link className="btn ink" to="/accession">
            New accession
          </Link>
        </div>
      </div>

      {sources === null ? (
        <span className="spinner" />
      ) : sources.length === 0 ? (
        <div className="empty">
          <h2>The ledger is empty.</h2>
          <p>Accession a link, file or note to start the catalogue.</p>
          <Link className="btn ink" to="/accession">Go to the accession desk</Link>
        </div>
      ) : (
        <div className="ledger-wrap">
        <table className="ledger">
          <thead>
            <tr>
              <th>Accession</th>
              <th>Title</th>
              <th className="hide-s">Kind</th>
              <th className="hide-s">Received</th>
              <th className="num">Objects</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <Fragment key={s.id}>
                <tr className={openId === s.id ? 'open' : undefined}>
                  <td className="cat">{s.accession}</td>
                  <td>
                    <button className="title" onClick={() => toggle(s.id)} aria-expanded={openId === s.id}>
                      {s.title}
                    </button>
                    {s.url && (
                      <div className="cat" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420, whiteSpace: 'nowrap' }}>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {s.url}
                        </a>
                      </div>
                    )}
                    {s.error && <div className="err">{s.error}</div>}
                  </td>
                  <td className="hide-s muted">{s.kind}</td>
                  <td className="hide-s muted">{relDays(s.createdAt)}</td>
                  <td className="num">{s.conceptCount}</td>
                  <td>
                    <span className={`status ${s.status}`}>{s.status}</span>
                  </td>
                </tr>
                {openId === s.id && (
                  <tr>
                    <td colSpan={6} className="expanded">
                      {!detail ? (
                        <span className="spinner" />
                      ) : (
                        <div style={{ display: 'grid', gap: 18 }}>
                          {detail.concepts.length > 0 && (
                            <div className="links">
                              {detail.concepts.map((c) => (
                                <Link key={c.id} className="chip" to={`/?c=${c.id}`}>
                                  <span className="cat">{c.catalog}</span> {c.name}
                                </Link>
                              ))}
                            </div>
                          )}
                          <details>
                            <summary style={{ cursor: 'pointer', fontSize: '0.86rem' }}>{detail.passages.length} passages</summary>
                            <div style={{ maxHeight: 360, overflow: 'auto', marginTop: 8 }}>
                              {detail.passages.map((p, i) => (
                                <div key={p.id} className="passage">
                                  <span className="cat">§{i + 1}</span>
                                  {p.text}
                                </div>
                              ))}
                            </div>
                          </details>
                          <div className="actions">
                            {s.status === 'failed' && (
                              <button className="btn small" onClick={() => api.retry(s.id).then(load)}>
                                <Icon name="retry" size={15} /> Develop again
                              </button>
                            )}
                            {confirm === s.id ? (
                              <button
                                className="btn small danger"
                                onClick={async () => {
                                  await api.deleteSource(s.id);
                                  setConfirm(null);
                                  setParams({}, { replace: true });
                                  await Promise.all([load(), refresh()]);
                                  toast(`${s.accession} removed.`);
                                }}
                              >
                                Remove {s.accession} and its orphaned objects
                              </button>
                            ) : (
                              <button className="btn small quiet" onClick={() => setConfirm(s.id)}>
                                <Icon name="trash" size={15} /> Remove
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

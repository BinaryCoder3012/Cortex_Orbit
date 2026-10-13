import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LogPayload } from '@cortex/core';
import { api } from '../lib/api.ts';
import { fmtDays, useVault } from '../lib/store.tsx';
import { StepWedge } from '../components/StepWedge.tsx';

export function LogPage() {
  const { toast } = useVault();
  const [log, setLog] = useState<LogPayload | null>(null);
  useEffect(() => {
    api.log().then(setLog).catch((e) => toast(e.message, true));
  }, [toast]);

  if (!log) return <div className="page"><span className="spinner" /></div>;
  const t = log.totals;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Observing <em>log</em>
          </h1>
          <p>What you've reviewed, and where your recall is heading if you stop now.</p>
        </div>
      </div>

      <div className="ledger-line">
        <span><b>{t.concepts}</b>stars</span>
        <span><b>{t.cards}</b>cards</span>
        <span><b>{t.sources}</b>sources</span>
        <span><b>{t.reviews}</b>reviews logged</span>
        <span><b>{t.gapsOpen}</b>open gaps</span>
      </div>

      <div className="log-grid">
        <section>
          <h2>Forecast without review</h2>
          <p className="muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
            Mean recall across your sky (line) and the number of ghosts (bars) over the next 30 days, if you stopped reviewing today.
          </p>
          <Forecast data={log.forecast} />
        </section>

        <section className="fade-list">
          <h2>Going faint this week</h2>
          {log.fading.length === 0 ? (
            <p className="muted" style={{ marginTop: 8 }}>Nothing crosses below half in the next seven days.</p>
          ) : (
            <>
              <ul style={{ marginTop: 8 }}>
                {log.fading.map((f) => (
                  <li key={f.id}>
                    <Link to={`/?c=${f.id}`}>{f.name}</Link>
                    <StepWedge value={f.retention} />
                    <span className="cat">
                      {f.catalog} · below half {fmtDays(f.fadesInDays)}
                    </span>
                    <span className="cat">{Math.round(f.retention * 100)}%</span>
                  </li>
                ))}
              </ul>
              <Link className="btn ink small" to="/session?mode=fading" style={{ marginTop: 14 }}>
                Review the fading ones
              </Link>
            </>
          )}
        </section>
      </div>

      <section style={{ marginTop: 56 }}>
        <h2>Exposures, last 17 weeks</h2>
        <Calendar reviews={log.reviews} />
      </section>
    </div>
  );
}

function Forecast({ data }: { data: LogPayload['forecast'] }) {
  const W = 560;
  const H = 230;
  const pad = { l: 34, r: 34, t: 14, b: 26 };
  const maxDay = 30;
  const maxGhost = Math.max(1, ...data.map((d) => d.ghosts));
  const x = (d: number) => pad.l + (d / maxDay) * (W - pad.l - pad.r);
  const y = (r: number) => pad.t + (1 - r) * (H - pad.t - pad.b);
  const yg = (g: number) => H - pad.b - (g / maxGhost) * (H - pad.t - pad.b) * 0.55;

  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(d.day).toFixed(1)} ${y(d.meanRetention).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data[data.length - 1].day)} ${y(0)} L${x(0)} ${y(0)} Z`;
  const last = data[data.length - 1];

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Mean recall falls from ${Math.round(data[0].meanRetention * 100)}% today to ${Math.round(last.meanRetention * 100)}% in 30 days without review; ghosts rise to ${last.ghosts}.`} style={{ marginTop: 14 }}>
      {[0, 0.25, 0.5, 0.75, 1].map((r) => (
        <g key={r}>
          <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(r)} y2={y(r)} />
          <text x={pad.l - 6} y={y(r) + 3} textAnchor="end">{Math.round(r * 100)}</text>
        </g>
      ))}
      <line className="half" x1={pad.l} x2={W - pad.r} y1={y(0.5)} y2={y(0.5)} />
      {data.map((d) => (
        <rect key={d.day} className="ghosts" x={x(d.day) - 3} width={6} y={yg(d.ghosts)} height={H - pad.b - yg(d.ghosts)} />
      ))}
      <path className="area" d={area} />
      <path className="curve" d={line} />
      {data.map((d) => (
        <text key={d.day} x={x(d.day)} y={H - 8} textAnchor="middle">{d.day === 0 ? 'now' : `+${d.day}`}</text>
      ))}
      <text x={W - pad.r + 6} y={yg(last.ghosts) + 3} style={{ fill: 'var(--vermilion-text)' }}>{last.ghosts}</text>
      <text x={x(last.day) + 6} y={y(last.meanRetention) - 6} style={{ fill: 'var(--ink)' }}>{Math.round(last.meanRetention * 100)}%</text>
    </svg>
  );
}

function Calendar({ reviews }: { reviews: LogPayload['reviews'] }) {
  const cells = useMemo(() => {
    const byDay = new Map(reviews.map((r) => [r.day, r.count]));
    const max = Math.max(1, ...reviews.map((r) => r.count));
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 7 * 17 + 1 - start.getDay());
    const out: { day: string; count: number; level: number }[] = [];
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const count = byDay.get(key) ?? 0;
      out.push({ day: key, count, level: count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)) });
    }
    return out;
  }, [reviews]);

  return (
    <div className="calendar" role="img" aria-label={`${reviews.reduce((s, r) => s + r.count, 0)} reviews over the last 17 weeks`}>
      {cells.map((c) => (
        <i key={c.day} data-l={c.level} title={`${c.day}: ${c.count} review${c.count === 1 ? '' : 's'}`} />
      ))}
    </div>
  );
}

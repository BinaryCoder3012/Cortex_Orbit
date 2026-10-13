import { useMemo } from 'react';
import { conceptRetention, DAY_MS, type AtlasPayload } from '@cortex/core';

const MIN = -30;
const MAX = 60;
const TICKS = [-30, -14, 0, 7, 14, 30, 60];

export function ExposureDial({ atlas, value, onChange }: { atlas: AtlasPayload; value: number; onChange: (v: number) => void }) {
  const reading = useMemo(() => {
    const at = new Date(new Date(atlas.now).getTime() + value * DAY_MS);
    let sum = 0;
    let n = 0;
    let ghosts = 0;
    for (const c of atlas.concepts) {
      if (new Date(c.createdAt).getTime() > at.getTime()) continue;
      const r = conceptRetention(atlas.memory[c.id] ?? [], c.createdAt, at);
      sum += r;
      n++;
      if (r < 0.4) ghosts++;
    }
    return { mean: n ? sum / n : 0, ghosts, n };
  }, [atlas, value]);

  const when =
    value === 0 ? 'Today' : value > 0 ? `In ${value} day${value === 1 ? '' : 's'}` : `${-value} day${value === -1 ? '' : 's'} ago`;
  const pos = (d: number) => `${((d - MIN) / (MAX - MIN)) * 100}%`;

  return (
    <div className="dial">
      <div className={`dial-read${value > 0 ? ' future' : ''}`} aria-live="polite">
        <b>{when}</b>
        <span>
          {reading.n} stars · {Math.round(reading.mean * 100)}% mean recall · {reading.ghosts} ghost{reading.ghosts === 1 ? '' : 's'}
        </span>
      </div>
      <div className="dial-track">
        <div
          className={`dial-shadow${value < 0 ? ' past' : ''}`}
          aria-hidden="true"
          style={{ left: value >= 0 ? pos(0) : pos(value), width: `${(Math.abs(value) / (MAX - MIN)) * 100}%` }}
        />
        <label className="sr-only" htmlFor="exposure">
          Sundial: move into the future to see what you would forget without review
        </label>
        <input
          id="exposure"
          type="range"
          min={MIN}
          max={MAX}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          list="exposure-ticks"
        />
        <div className="dial-ticks" aria-hidden="true">
          {TICKS.map((t) => (
            <span key={t} className={t === 0 ? 'now' : undefined} style={{ left: pos(t) }}>
              {t === 0 ? 'today' : t > 0 ? `+${t}d` : `${t}d`}
            </span>
          ))}
        </div>
      </div>
      <button className="btn quiet small reset" onClick={() => onChange(0)} disabled={value === 0}>
        Back to today
      </button>
    </div>
  );
}

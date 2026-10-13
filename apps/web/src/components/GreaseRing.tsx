import { useMemo } from 'react';

/** A hand-drawn grease-pencil loop around its box. Deterministic per seed. */
export function GreaseRing({ seed, w = 400, h = 220 }: { seed: number; w?: number; h?: number }) {
  const d = useMemo(() => ringPath(seed, w, h), [seed, w, h]);
  return (
    <svg className="ring" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} vectorEffect="non-scaling-stroke" style={{ ['--len' as string]: 2600 }} />
    </svg>
  );
}

export function rand(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function ringPath(seed: number, w: number, h: number) {
  const r = rand(seed);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 - 6;
  const ry = h / 2 - 6;
  const turns = 1.12 + r() * 0.1;
  const start = -Math.PI * (0.55 + r() * 0.2);
  const pts: string[] = [];
  const n = 64;
  const wob1 = r() * 6;
  const wob2 = r() * 6;
  for (let i = 0; i <= n; i++) {
    const t = start + (i / n) * Math.PI * 2 * turns;
    const drift = 1 + (i / n) * 0.035;
    const wob = Math.sin(t * 3 + wob1) * 0.012 + Math.sin(t * 5 + wob2) * 0.008;
    const x = cx + Math.cos(t) * rx * (drift + wob);
    const y = cy + Math.sin(t) * ry * (drift - wob);
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

import type { Concept, Edge, Gap } from '@cortex/core';

export interface Body {
  key: string; // c12 or g3
  kind: 'concept' | 'gap';
  ref: number;
  x: number;
  y: number;
  z: number;
}

const hash = (n: number) => {
  let h = n * 2654435761;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967295;
};

/**
 * A small 3D force simulation: charge repulsion, springs along edges, a gentle
 * pull toward each source's cluster centre, and centring. Seeded from ids so
 * the same vault always develops into the same sky.
 */
export function developSky(concepts: Concept[], edges: Edge[], gaps: Gap[]): Map<string, Body> {
  const bodies: (Body & { vx: number; vy: number; vz: number; group: number; mass: number })[] = [];
  const groups = [...new Set(concepts.map((c) => c.sourceIds[0] ?? 0))];
  const gCentre = new Map<number, [number, number, number]>();
  groups.forEach((g, i) => {
    // spread cluster centres on a Fibonacci sphere
    const k = groups.length;
    const y = k === 1 ? 0 : 1 - (i / (k - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    gCentre.set(g, [Math.cos(th) * r * 230, y * 160, Math.sin(th) * r * 230]);
  });

  for (const c of concepts) {
    const g = c.sourceIds[0] ?? 0;
    const [cx, cy, cz] = gCentre.get(g)!;
    bodies.push({
      key: `c${c.id}`,
      kind: 'concept',
      ref: c.id,
      x: cx + (hash(c.id) - 0.5) * 120,
      y: cy + (hash(c.id + 7919) - 0.5) * 120,
      z: cz + (hash(c.id + 104729) - 0.5) * 120,
      vx: 0,
      vy: 0,
      vz: 0,
      group: g,
      mass: 0.6 + c.importance * 0.2,
    });
  }
  const index = new Map(bodies.map((b, i) => [b.key, i]));

  const springs: [number, number, number, number][] = []; // a, b, length, strength
  for (const e of edges) {
    const a = index.get(`c${e.from}`);
    const b = index.get(`c${e.to}`);
    if (a == null || b == null) continue;
    springs.push([a, b, e.type === 'part_of' ? 48 : 70, e.type === 'related' ? 0.025 : 0.05]);
  }

  for (const g of gaps) {
    const anchors = g.between.map((id) => index.get(`c${id}`)).filter((i): i is number => i != null);
    if (anchors.length === 0) continue;
    const m = anchors.reduce((acc, i) => [acc[0] + bodies[i].x, acc[1] + bodies[i].y, acc[2] + bodies[i].z], [0, 0, 0]);
    const n = anchors.length;
    const bi = bodies.length;
    bodies.push({
      key: `g${g.id}`,
      kind: 'gap',
      ref: g.id,
      x: m[0] / n + 20,
      y: m[1] / n - 20,
      z: m[2] / n,
      vx: 0,
      vy: 0,
      vz: 0,
      group: -1,
      mass: 1,
    });
    for (const a of anchors) springs.push([bi, a, 60, 0.05]);
  }

  const N = bodies.length;
  const iterations = N > 300 ? 160 : 280;
  for (let it = 0; it < iterations; it++) {
    const alpha = 1 - it / iterations;
    // repulsion
    for (let i = 0; i < N; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < N; j++) {
        const b = bodies[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = a.z - b.z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1) {
          dx = (hash(i * 31 + j) - 0.5) * 2;
          dy = (hash(j * 17 + i) - 0.5) * 2;
          dz = 0.5;
          d2 = 1;
        }
        if (d2 > 90000) continue;
        const f = (900 * alpha) / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        const fz = (dz / d) * f;
        a.vx += fx / a.mass;
        a.vy += fy / a.mass;
        a.vz += fz / a.mass;
        b.vx -= fx / b.mass;
        b.vy -= fy / b.mass;
        b.vz -= fz / b.mass;
      }
    }
    // springs
    for (const [ai, bi, len, k] of springs) {
      const a = bodies[ai];
      const b = bodies[bi];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const f = (d - len) * k * alpha;
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      a.vz += (dz / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
      b.vz -= (dz / d) * f;
    }
    // cluster pull and centring
    for (const b of bodies) {
      const c = gCentre.get(b.group);
      if (c) {
        b.vx += (c[0] - b.x) * 0.018 * alpha;
        b.vy += (c[1] - b.y) * 0.018 * alpha;
        b.vz += (c[2] - b.z) * 0.018 * alpha;
      }
      b.vx -= b.x * 0.0015;
      b.vy -= b.y * 0.0015;
      b.vz -= b.z * 0.0015;
      b.vx *= 0.82;
      b.vy *= 0.82;
      b.vz *= 0.82;
      b.x += b.vx;
      b.y += b.vy;
      b.z += b.vz;
    }
  }

  // normalise into a sphere of radius ~240
  let maxR = 1;
  for (const b of bodies) maxR = Math.max(maxR, Math.hypot(b.x, b.y, b.z));
  const scale = Math.min(2.2, 240 / maxR);
  const out = new Map<string, Body>();
  for (const b of bodies) out.set(b.key, { key: b.key, kind: b.kind, ref: b.ref, x: b.x * scale, y: b.y * scale, z: b.z * scale });
  return out;
}

/** Faint field stars on a far shell, for parallax. */
export function fieldStars(n = 160): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = hash(i * 13 + 1);
    const v = hash(i * 29 + 3);
    const th = u * Math.PI * 2;
    const ph = Math.acos(2 * v - 1);
    const r = 520 + hash(i * 7 + 5) * 260;
    out.push([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th), hash(i * 3 + 11)]);
  }
  return out;
}

import { useEffect, useMemo, useRef } from 'react';
import { conceptRetention, DAY_MS, type AtlasPayload, type Concept } from '@cortex/core';
import { developSky, fieldStars, type Body } from './layout.ts';
import { rand } from '../components/GreaseRing.tsx';

export type PlateFilter = 'all' | 'fading' | 'gaps';

interface Props {
  atlas: AtlasPayload;
  offsetDays: number;
  selected: number | null;
  filter: PlateFilter;
  matches: Set<number> | null;
  drawerOpen: boolean;
  onSelect: (id: number | null) => void;
  onSelectGap: (id: number) => void;
}

interface Palette {
  ink: string;
  ink2: string;
  ink3: string;
  ground: string;
  marble: string;
  vermilion: string;
  saffron: string;
  saffronDeep: string;
}

const readPalette = (): Palette => {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    ground: v('--ground'),
    marble: v('--marble-2'),
    vermilion: v('--vermilion'),
    saffron: v('--saffron'),
    saffronDeep: v('--saffron-deep'),
  };
};

const D = 900; // camera distance
const smooth = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function PlateCanvas({ atlas, offsetDays, selected, filter, matches, drawerOpen, onSelect, onSelectGap }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sky = useMemo(() => developSky(atlas.concepts, atlas.edges, atlas.gaps), [atlas]);
  const field = useMemo(() => fieldStars(), []);
  const byId = useMemo(() => new Map(atlas.concepts.map((c) => [c.id, c])), [atlas]);

  // retention now and at the dial's time, computed client-side from memory traces
  const recall = useMemo(() => {
    const now = new Date(atlas.now);
    const at = new Date(now.getTime() + offsetDays * DAY_MS);
    const m = new Map<number, { now: number; at: number }>();
    for (const c of atlas.concepts) {
      const traces = atlas.memory[c.id] ?? [];
      // before a concept was learned, it is not on the plate at all
      const born = new Date(c.createdAt).getTime() <= at.getTime();
      m.set(c.id, {
        now: conceptRetention(traces, c.createdAt, now),
        at: born ? conceptRetention(traces, c.createdAt, at) : -1,
      });
    }
    return m;
  }, [atlas, offsetDays]);

  // everything the render loop reads lives in a ref so React re-renders never restart it
  const state = useRef({
    yaw: 0.4,
    pitch: -0.18,
    targetYaw: null as number | null,
    targetPitch: null as number | null,
    zoom: 1,
    hover: null as string | null,
    drag: null as { x: number; y: number; yaw: number; pitch: number; moved: boolean } | null,
    palette: null as Palette | null,
    dirty: true,
    shift: 0,
  });
  const props = useRef({ sky, recall, byId, selected, filter, matches, drawerOpen, atlas, offsetDays });
  props.current = { sky, recall, byId, selected, filter, matches, drawerOpen, atlas, offsetDays };
  state.current.dirty = true;

  // turn the sky so the selected star faces the viewer
  useEffect(() => {
    if (selected == null) return;
    const b = sky.get(`c${selected}`);
    if (!b) return;
    const s = state.current;
    const yaw = Math.atan2(-b.x, b.z);
    const z1 = -b.x * Math.sin(yaw) + b.z * Math.cos(yaw);
    const pitch = Math.atan2(b.y, z1);
    // take the short way round
    let dy = yaw - s.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    s.targetYaw = s.yaw + dy;
    s.targetPitch = Math.max(-1.1, Math.min(1.1, pitch));
  }, [selected, sky]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const s = state.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let projected: { key: string; kind: Body['kind']; ref: number; sx: number; sy: number; r: number; depth: number }[] = [];

    const repaint = () => {
      s.palette = readPalette();
      s.dirty = true;
    };
    repaint();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', repaint);
    window.addEventListener('cortex:print', repaint);
    document.fonts?.ready.then(repaint);

    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      s.dirty = true;
    });
    ro.observe(canvas);

    const project = (x: number, y: number, z: number, cx: number, cy: number, f: number) => {
      const cyw = Math.cos(s.yaw);
      const syw = Math.sin(s.yaw);
      const x1 = x * cyw + z * syw;
      const z1 = -x * syw + z * cyw;
      const cp = Math.cos(s.pitch);
      const sp = Math.sin(s.pitch);
      const y1 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      const k = f / (D - z2);
      return { sx: cx + x1 * k, sy: cy - y1 * k, k, z: z2 };
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const P = props.current;
      // ease toward a requested orientation, otherwise drift slowly while idle
      if (s.targetYaw != null && s.targetPitch != null) {
        s.yaw = smooth(s.yaw, s.targetYaw, 0.08);
        s.pitch = smooth(s.pitch, s.targetPitch, 0.08);
        if (Math.abs(s.yaw - s.targetYaw) < 0.002 && Math.abs(s.pitch - s.targetPitch) < 0.002) {
          s.targetYaw = s.targetPitch = null;
        }
        s.dirty = true;
      } else if (!reduced && !s.drag && !s.hover && P.selected == null && !document.hidden) {
        s.yaw += 0.0007;
        s.dirty = true;
      }
      const shiftTarget = P.drawerOpen && w > 860 ? -Math.min(220, w * 0.18) : 0;
      if (Math.abs(s.shift - shiftTarget) > 0.5) {
        s.shift = smooth(s.shift, shiftTarget, 0.12);
        s.dirty = true;
      }
      if (!s.dirty || !s.palette || w === 0) return;
      s.dirty = false;
      draw(P);
    };

    const draw = (P: typeof props.current) => {
      const pal = s.palette!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2 + s.shift;
      const cy = h / 2 - 10;
      const f = Math.min(w, h) * 1.75 * s.zoom;

      engrave(ctx, pal, cx, cy, Math.min(w, h) * 0.43, s.yaw);

      // field stars
      ctx.fillStyle = pal.ink;
      for (const [x, y, z, m] of field) {
        const p = project(x, y, z, cx, cy, f * 0.9);
        if (p.z > D - 50) continue;
        ctx.globalAlpha = 0.12 + m * 0.18;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 0.4 + m * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      projected = [];
      let zMin = Infinity;
      let zMax = -Infinity;
      const pos = new Map<string, { sx: number; sy: number; k: number; z: number }>();
      for (const b of P.sky.values()) {
        const p = project(b.x, b.y, b.z, cx, cy, f);
        pos.set(b.key, p);
        zMin = Math.min(zMin, p.z);
        zMax = Math.max(zMax, p.z);
      }
      const depthOf = (z: number) => (zMax - zMin < 1 ? 1 : (z - zMin) / (zMax - zMin));

      const sel = P.selected;
      const hoverKey = s.hover;
      const neighbours = new Set<number>();
      for (const e of P.atlas.edges) {
        if (e.from === sel) neighbours.add(e.to);
        if (e.to === sel) neighbours.add(e.from);
      }
      const dimFor = (c: Concept) => {
        const r = P.recall.get(c.id)!;
        if (P.matches && !P.matches.has(c.id)) return 0.18;
        if (P.filter === 'fading' && r.at >= 0.65) return 0.15;
        if (P.filter === 'gaps') return 0.35;
        return 1;
      };

      // edges
      ctx.lineCap = 'round';
      for (const e of P.atlas.edges) {
        const a = pos.get(`c${e.from}`);
        const b = pos.get(`c${e.to}`);
        const ca = P.byId.get(e.from);
        const cb = P.byId.get(e.to);
        if (!a || !b || !ca || !cb) continue;
        const ra = P.recall.get(e.from)!.at;
        const rb = P.recall.get(e.to)!.at;
        if (ra < 0 || rb < 0) continue;
        const lit = sel != null && (e.from === sel || e.to === sel);
        const depth = (depthOf(a.z) + depthOf(b.z)) / 2;
        const dim = Math.min(dimFor(ca), dimFor(cb));
        ctx.globalAlpha = (lit ? 0.7 : 0.13 + depth * 0.12) * dim * (0.4 + 0.6 * Math.min(ra, rb));
        ctx.strokeStyle = pal.ink;
        ctx.lineWidth = lit ? 1.2 : 0.8;
        ctx.setLineDash(e.type === 'contrasts' ? [3, 4] : e.type === 'related' ? [1, 3] : []);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
        if (lit && e.type === 'prerequisite') {
          // a small arrow tick two-thirds along, pointing at what it unlocks
          const t = 0.62;
          const mx = a.sx + (b.sx - a.sx) * t;
          const my = a.sy + (b.sy - a.sy) * t;
          const ang = Math.atan2(b.sy - a.sy, b.sx - a.sx);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(mx - Math.cos(ang - 0.5) * 6, my - Math.sin(ang - 0.5) * 6);
          ctx.lineTo(mx, my);
          ctx.lineTo(mx - Math.cos(ang + 0.5) * 6, my - Math.sin(ang + 0.5) * 6);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // stars, far to near
      const order = [...P.sky.values()].sort((a, b) => pos.get(a.key)!.z - pos.get(b.key)!.z);
      const labels: { x: number; y: number; text: string; sub?: string; strong: boolean; alpha: number; ghost: boolean; gap?: boolean }[] = [];

      for (const b of order) {
        const p = pos.get(b.key)!;
        const depth = depthOf(p.z);
        const scale = p.k * (D / f) * 1.0;

        if (b.kind === 'gap') {
          const gap = P.atlas.gaps.find((g) => g.id === b.ref);
          if (!gap) continue;
          const show = P.filter !== 'fading' && !P.matches;
          if (!show) continue;
          const R = 15 * scale * (P.filter === 'gaps' ? 1.25 : 1);
          ctx.strokeStyle = pal.vermilion;
          ctx.globalAlpha = 0.5;
          ctx.setLineDash([2, 4]);
          ctx.lineWidth = 1;
          for (const id of gap.between) {
            const q = pos.get(`c${id}`);
            if (!q) continue;
            ctx.beginPath();
            ctx.moveTo(p.sx, p.sy);
            ctx.lineTo(q.sx, q.sy);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.globalAlpha = hoverKey === b.key ? 1 : 0.85;
          greaseLoop(ctx, pal.vermilion, p.sx, p.sy, R, R * 0.86, b.ref, 2);
          labels.push({ x: p.sx + R + 4, y: p.sy - R * 0.4, text: `${gap.name}?`, strong: true, alpha: 1, ghost: false, gap: true });
          projected.push({ key: b.key, kind: 'gap', ref: b.ref, sx: p.sx, sy: p.sy, r: R, depth });
          continue;
        }

        const c = P.byId.get(b.ref);
        if (!c) continue;
        const r = P.recall.get(c.id)!;
        if (r.at < 0) continue; // not yet learned at this point on the dial
        const dim = dimFor(c);
        const base = (2.2 + c.importance * 1.35) * scale;
        const ret = r.at;
        const isSel = sel === c.id;
        const isHover = hoverKey === b.key;
        const depthA = 0.55 + depth * 0.45;

        // sunlight: a remembered star glows saffron around its pigment
        const halo = clamp01((ret - 0.55) / 0.45);
        if (halo > 0) {
          const g = ctx.createRadialGradient(p.sx, p.sy, base * 0.4, p.sx, p.sy, base * 3.4);
          g.addColorStop(0, withAlpha(pal.saffron, 0.55 * halo * dim * depthA));
          g.addColorStop(0.45, withAlpha(pal.saffron, 0.16 * halo * dim * depthA));
          g.addColorStop(1, withAlpha(pal.saffron, 0));
          ctx.globalAlpha = 1;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, base * 3.4, 0, Math.PI * 2);
          ctx.fill();
        }

        // the pigment wears away as recall fades
        const core = base * (0.5 + 0.5 * ret);
        const density = clamp01((ret - 0.22) / 0.6);
        ctx.globalAlpha = density * dim * depthA;
        ctx.fillStyle = pal.ink;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, core, 0, Math.PI * 2);
        ctx.fill();

        // a ghost keeps only its carved outline, the pigment gone
        const ghostness = clamp01((0.5 - ret) / 0.3);
        if (ghostness > 0) {
          ctx.globalAlpha = (0.35 + 0.35 * ghostness) * dim * depthA;
          ctx.strokeStyle = pal.ink2;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2.5]);
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, base * 0.85, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // looking ahead on the dial: ring what would go ghost before then
        if (P.offsetDays > 0 && r.now >= 0.4 && ret < 0.4 && dim > 0.5) {
          ctx.globalAlpha = 0.9;
          greaseLoop(ctx, pal.vermilion, p.sx, p.sy, base + 7, base + 6, c.id, 1.6);
        }

        if (isSel || isHover) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = pal.saffronDeep;
          ctx.lineWidth = 1.6;
          const g0 = base + 5;
          const g1 = base + 13;
          ctx.beginPath();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            ctx.moveTo(p.sx + dx * g0, p.sy + dy * g0);
            ctx.lineTo(p.sx + dx * g1, p.sy + dy * g1);
          }
          ctx.stroke();
        }

        const labelled =
          isSel || isHover || neighbours.has(c.id) || (P.matches?.has(c.id) ?? false) ||
          (c.importance >= 4 && depth > 0.25 && dim > 0.5) || (P.filter === 'fading' && dim === 1);
        if (labelled) {
          labels.push({
            x: p.sx + base + (isSel || isHover ? 16 : 6),
            y: p.sy + 4,
            text: c.name,
            sub: isSel ? `${c.catalog} · ${Math.round(ret * 100)}%` : undefined,
            strong: isSel || isHover,
            alpha: Math.max(0.35, dim) * (0.6 + depth * 0.4),
            ghost: ret < 0.4,
          });
        }
        projected.push({ key: b.key, kind: 'concept', ref: c.id, sx: p.sx, sy: p.sy, r: Math.max(base, 6), depth });
      }

      // labels last, with a stone-coloured knockout so they read over lines
      ctx.textBaseline = 'alphabetic';
      for (const l of labels) {
        const isGap = !!l.gap;
        ctx.font = isGap ? `400 17px Kalam, cursive` : l.strong ? `700 16px Rajdhani, sans-serif` : `500 13px Yantramanav, sans-serif`;
        ctx.globalAlpha = l.alpha;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = pal.ground;
        ctx.lineWidth = 4;
        ctx.strokeText(l.text, l.x, l.y);
        ctx.fillStyle = isGap ? pal.vermilion : l.ghost ? pal.ink3 : l.strong ? pal.ink : pal.ink2;
        ctx.fillText(l.text, l.x, l.y);
        if (l.sub) {
          ctx.font = `600 12px Rajdhani, sans-serif`;
          ctx.strokeText(l.sub, l.x, l.y + 16);
          ctx.fillStyle = pal.ink3;
          ctx.fillText(l.sub, l.x, l.y + 16);
        }
      }
      ctx.globalAlpha = 1;
    };

    const hit = (x: number, y: number) => {
      let best: (typeof projected)[number] | null = null;
      let bestD = Infinity;
      for (const p of projected) {
        const d = Math.hypot(p.sx - x, p.sy - y);
        if (d < p.r + 8 && d - p.depth * 4 < bestD) {
          best = p;
          bestD = d - p.depth * 4;
        }
      }
      return best;
    };

    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      s.drag = { x: e.clientX, y: e.clientY, yaw: s.yaw, pitch: s.pitch, moved: false };
      s.targetYaw = s.targetPitch = null;
    };
    const onMove = (e: PointerEvent) => {
      if (s.drag) {
        const dx = e.clientX - s.drag.x;
        const dy = e.clientY - s.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          s.drag.moved = true;
          canvas.classList.add('dragging');
        }
        s.yaw = s.drag.yaw + dx * 0.006;
        s.pitch = Math.max(-1.3, Math.min(1.3, s.drag.pitch + dy * 0.006));
        s.dirty = true;
        return;
      }
      const { x, y } = local(e);
      const h2 = hit(x, y);
      const key = h2?.key ?? null;
      if (key !== s.hover) {
        s.hover = key;
        s.dirty = true;
        canvas.classList.toggle('over-star', !!key);
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = s.drag;
      s.drag = null;
      canvas.classList.remove('dragging');
      if (d && !d.moved) {
        const { x, y } = local(e);
        const h2 = hit(x, y);
        if (h2?.kind === 'gap') onSelectGapRef.current(h2.ref);
        else onSelectRef.current(h2?.kind === 'concept' ? h2.ref : null);
      }
    };
    const onLeave = () => {
      if (s.hover) {
        s.hover = null;
        s.dirty = true;
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      s.zoom = Math.max(0.5, Math.min(2.8, s.zoom * Math.exp(-e.deltaY * 0.0012)));
      s.dirty = true;
    };
    const onKey = (e: KeyboardEvent) => {
      const step = 0.12;
      if (e.key === 'ArrowLeft') s.yaw -= step;
      else if (e.key === 'ArrowRight') s.yaw += step;
      else if (e.key === 'ArrowUp') s.pitch = Math.max(-1.3, s.pitch - step);
      else if (e.key === 'ArrowDown') s.pitch = Math.min(1.3, s.pitch + step);
      else if (e.key === '+' || e.key === '=') s.zoom = Math.min(2.8, s.zoom * 1.15);
      else if (e.key === '-') s.zoom = Math.max(0.5, s.zoom / 1.15);
      else return;
      e.preventDefault();
      s.dirty = true;
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener('change', repaint);
      window.removeEventListener('cortex:print', repaint);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
    };
  }, [field]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSelectGapRef = useRef(onSelectGap);
  onSelectGapRef.current = onSelectGap;

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      aria-label="Star plate of your concepts. Drag or use arrow keys to turn it, scroll or plus and minus to zoom. The list after the plate gives the same objects as buttons."
    />
  );
}

/** A scribe's vermilion loop: slightly more than one turn, wobbling, never closing cleanly. */
function greaseLoop(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, rx: number, ry: number, seed: number, width: number) {
  const r = rand(seed + 11);
  const start = -Math.PI * (0.5 + r() * 0.3);
  const turns = 1.1 + r() * 0.12;
  const w1 = r() * 6;
  const tilt = (r() - 0.5) * 0.4;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = start + (i / n) * Math.PI * 2 * turns;
    const grow = 1 + (i / n) * 0.07;
    const wob = Math.sin(t * 3 + w1) * 0.04;
    const px = Math.cos(t) * rx * (grow + wob);
    const py = Math.sin(t) * ry * (grow - wob);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

function withAlpha(color: string, a: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  return color;
}

/**
 * The instrument face: engraved declination circles and hour lines fixed in the
 * stone, inside a marble scale ring whose graduations turn with the sky.
 */
function engrave(ctx: CanvasRenderingContext2D, pal: Palette, cx: number, cy: number, R: number, yaw: number) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.ink;

  // declination circles
  ctx.globalAlpha = 0.07;
  for (const k of [0.22, 0.44, 0.66, 0.86]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  // hour lines, every fifteen degrees
  ctx.globalAlpha = 0.05;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.moveTo(cx + Math.cos(a) * R * 0.1, cy + Math.sin(a) * R * 0.1);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
  }
  ctx.stroke();

  // the inlaid marble ring
  const ring = Math.max(14, R * 0.045);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = pal.marble;
  ctx.beginPath();
  ctx.arc(cx, cy, R + ring, 0, Math.PI * 2);
  ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.moveTo(cx + R + ring, cy);
  ctx.arc(cx, cy, R + ring, 0, Math.PI * 2);
  ctx.stroke();

  // graduations: every 2 degrees, long every 10, numbered every 30
  ctx.font = '600 10px Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let d = 0; d < 360; d += 2) {
    const a = (d * Math.PI) / 180 + yaw;
    const long = d % 10 === 0;
    const r0 = R + (long ? ring * 0.35 : ring * 0.62);
    ctx.globalAlpha = long ? 0.42 : 0.24;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.lineTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.stroke();
    if (d % 30 === 0) {
      const rt = R + ring * 0.74;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = pal.ink2;
      ctx.fillText(String(d), cx + Math.cos(a) * rt, cy + Math.sin(a) * rt);
    }
  }
  ctx.restore();
}

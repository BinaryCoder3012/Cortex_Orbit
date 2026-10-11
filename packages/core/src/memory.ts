import type { MemoryState, MemoryTrace } from './types.ts';

export const DAY_MS = 86_400_000;

/** UI grades map onto SM-2's 0..5 quality scale. */
export const GRADES = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
} as const;
export type GradeName = keyof typeof GRADES;

export function freshMemory(now: Date): MemoryState {
  return {
    ease: 2.5,
    interval: 1,
    reps: 0,
    lapses: 0,
    lastReviewAt: null,
    dueAt: new Date(now.getTime() + DAY_MS).toISOString(),
  };
}

/**
 * Classic SM-2 (Wozniak, 1987) with two small departures:
 * a "hard" pass grows the interval by 1.2x instead of the full ease factor,
 * and intervals stay fractional so the forgetting curve is smooth.
 */
export function sm2(prev: MemoryState, quality: number, now: Date): MemoryState {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let { ease, interval, reps, lapses } = prev;

  if (q < 3) {
    reps = 0;
    interval = 1;
    lapses += 1;
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = q === 3 ? interval * 1.2 : interval * ease;
    if (q === 5 && reps <= 1) interval *= 1.5;
    reps += 1;
  }

  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  interval = Math.round(interval * 100) / 100;

  return {
    ease: Math.round(ease * 1000) / 1000,
    interval,
    reps,
    lapses,
    lastReviewAt: now.toISOString(),
    dueAt: new Date(now.getTime() + interval * DAY_MS).toISOString(),
  };
}

/**
 * Forgetting curve anchored on SM-2: retention is exactly 90% when a card
 * comes due, R(t) = 0.9^(elapsed / interval). Unreviewed cards decay from
 * the moment they were learned with a one-day stability.
 */
export function retention(m: MemoryTrace, at: Date): number {
  const anchor = new Date(m.lastReviewAt ?? m.createdAt).getTime();
  const elapsedDays = Math.max(0, (at.getTime() - anchor) / DAY_MS);
  const stability = Math.max(0.25, m.interval);
  return Math.pow(0.9, elapsedDays / stability);
}

/** A concept is as remembered as the mean of its cards. */
export function conceptRetention(cards: MemoryTrace[], conceptCreatedAt: string, at: Date): number {
  if (cards.length === 0) {
    return retention({ interval: 1, lastReviewAt: null, createdAt: conceptCreatedAt }, at);
  }
  let sum = 0;
  for (const c of cards) sum += retention(c, at);
  return sum / cards.length;
}

/** Days from `at` until retention falls below `threshold` (0 if already below). */
export function daysUntilFade(
  cards: MemoryTrace[],
  conceptCreatedAt: string,
  at: Date,
  threshold = 0.5,
): number {
  for (let d = 0; d <= 365; d += 0.5) {
    const t = new Date(at.getTime() + d * DAY_MS);
    if (conceptRetention(cards, conceptCreatedAt, t) < threshold) return d;
  }
  return Infinity;
}

export type Brightness = 'bright' | 'steady' | 'dimming' | 'ghost';

export function brightness(r: number): Brightness {
  if (r >= 0.85) return 'bright';
  if (r >= 0.65) return 'steady';
  if (r >= 0.4) return 'dimming';
  return 'ghost';
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sm2, freshMemory, retention, conceptRetention, daysUntilFade } from '../src/memory.ts';
import { normalizeName } from '../src/format.ts';

const t0 = new Date('2026-01-01T00:00:00Z');
const day = (n: number) => new Date(t0.getTime() + n * 86_400_000);

test('sm2 follows 1 → 6 → ease-scaled intervals on good answers', () => {
  let m = freshMemory(t0);
  m = sm2(m, 4, t0);
  assert.equal(m.interval, 1);
  m = sm2(m, 4, day(1));
  assert.equal(m.interval, 6);
  m = sm2(m, 4, day(7));
  assert.equal(m.interval, 15);
  assert.equal(m.reps, 3);
});

test('a lapse resets reps and interval, and lowers ease', () => {
  let m = freshMemory(t0);
  m = sm2(m, 5, t0);
  m = sm2(m, 5, day(1));
  const before = m.ease;
  m = sm2(m, 1, day(10));
  assert.equal(m.reps, 0);
  assert.equal(m.interval, 1);
  assert.equal(m.lapses, 1);
  assert.ok(m.ease < before);
  assert.ok(m.ease >= 1.3);
});

test('retention is 90% exactly at the due date', () => {
  const r = retention({ interval: 6, lastReviewAt: t0.toISOString(), createdAt: t0.toISOString() }, day(6));
  assert.ok(Math.abs(r - 0.9) < 1e-9);
});

test('concept retention averages cards and fades over time', () => {
  const cards = [
    { interval: 1, lastReviewAt: t0.toISOString(), createdAt: t0.toISOString() },
    { interval: 10, lastReviewAt: t0.toISOString(), createdAt: t0.toISOString() },
  ];
  const r1 = conceptRetention(cards, t0.toISOString(), day(1));
  const r5 = conceptRetention(cards, t0.toISOString(), day(5));
  assert.ok(r1 > r5);
  assert.ok(daysUntilFade(cards, t0.toISOString(), t0) > 0);
});

test('normalizeName folds plurals, punctuation and .js suffixes', () => {
  assert.equal(normalizeName('React Hooks'), normalizeName('react hook'));
  assert.equal(normalizeName('Node.js'), normalizeName('nodejs'));
  assert.equal(normalizeName('Class'), 'class');
});

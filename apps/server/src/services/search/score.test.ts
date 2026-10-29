import { describe, expect, it } from 'vitest';

import { normalizeSearchScore } from './score';

describe('normalizeSearchScore', () => {
  it.each([
    [undefined, 0],
    [null, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ])('returns zero for an absent or non-finite score: %s', (score, expected) => {
    expect(normalizeSearchScore(score)).toBe(expected);
  });

  it.each([
    [0, 0],
    [0.1234, 0.37],
    [0.95, 2.85],
    [1, 3],
  ])('maps a provider score to the shared 0–3 scale: %s', (score, expected) => {
    expect(normalizeSearchScore(score)).toBe(expected);
  });

  it.each([
    [-0.2, 0],
    [1.2, 3],
  ])('bounds an out-of-range provider score: %s', (score, expected) => {
    expect(normalizeSearchScore(score)).toBe(expected);
  });
});

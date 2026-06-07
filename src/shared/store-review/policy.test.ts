import { describe, expect, test } from 'vitest';
import dayjs from 'dayjs';
import { canRequestReview, DEFAULT_POLICY } from './policy';
import type { IReviewSnapshot } from './types';

// A snapshot that passes every gate. Each test overrides one field to fail one gate.
const passing = (): IReviewSnapshot => ({
  installedAt: dayjs().subtract(10, 'day').toISOString(),
  sessionStartedAt: dayjs().subtract(5, 'minute').toISOString(),
  launchCount: 10,
  keyActionCount: 5,
  lastRequestedAt: null,
  lastErrorAt: null,
  requestHistory: [],
  requestedThisSession: false,
});

const idle = { uiIsIdle: true };

describe('canRequestReview', () => {
  test('passes when all gates are satisfied', () => {
    expect(canRequestReview(passing(), idle)).toBe(true);
  });

  test('blocks when the UI is not idle', () => {
    expect(canRequestReview(passing(), { uiIsIdle: false })).toBe(false);
  });

  test('blocks when a request was already made this session', () => {
    expect(
      canRequestReview({ ...passing(), requestedThisSession: true }, idle),
    ).toBe(false);
  });

  test('blocks before the minimum days since install', () => {
    expect(
      canRequestReview(
        { ...passing(), installedAt: dayjs().subtract(1, 'day').toISOString() },
        idle,
      ),
    ).toBe(false);
  });

  test('blocks below the minimum launch count', () => {
    expect(canRequestReview({ ...passing(), launchCount: 2 }, idle)).toBe(false);
  });

  test('blocks below the minimum key-action count', () => {
    expect(canRequestReview({ ...passing(), keyActionCount: 1 }, idle)).toBe(
      false,
    );
  });

  test('blocks during the post-launch cooldown', () => {
    expect(
      canRequestReview(
        {
          ...passing(),
          sessionStartedAt: dayjs().subtract(10, 'second').toISOString(),
        },
        idle,
      ),
    ).toBe(false);
  });

  test('blocks within the min days since the last request', () => {
    expect(
      canRequestReview(
        { ...passing(), lastRequestedAt: dayjs().subtract(10, 'day').toISOString() },
        idle,
      ),
    ).toBe(false);
  });

  test('blocks when the yearly request quota is reached', () => {
    const requestHistory = [
      dayjs().subtract(1, 'month').toISOString(),
      dayjs().subtract(2, 'month').toISOString(),
      dayjs().subtract(3, 'month').toISOString(),
    ];
    expect(canRequestReview({ ...passing(), requestHistory }, idle)).toBe(false);
  });

  test('ignores requests older than a year when counting the quota', () => {
    const requestHistory = [
      dayjs().subtract(13, 'month').toISOString(),
      dayjs().subtract(14, 'month').toISOString(),
      dayjs().subtract(15, 'month').toISOString(),
    ];
    expect(canRequestReview({ ...passing(), requestHistory }, idle)).toBe(true);
  });

  test('blocks within the post-error window', () => {
    expect(
      canRequestReview(
        { ...passing(), lastErrorAt: dayjs().subtract(1, 'minute').toISOString() },
        idle,
      ),
    ).toBe(false);
  });

  test('allows once the post-error window has passed', () => {
    expect(
      canRequestReview(
        { ...passing(), lastErrorAt: dayjs().subtract(10, 'minute').toISOString() },
        idle,
      ),
    ).toBe(true);
  });

  test('respects a custom policy override', () => {
    const strict = { ...DEFAULT_POLICY, minLaunchCount: 50 };
    expect(canRequestReview(passing(), idle, strict)).toBe(false);
  });
});

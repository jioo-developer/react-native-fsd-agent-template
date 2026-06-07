import dayjs from 'dayjs';
import type {
  ICanRequestContext,
  IReviewPolicy,
  IReviewSnapshot,
} from './types';

/**
 * Mandated default gates. `maxRequestsPerYear` mirrors the iOS system quota
 * (max 3 prompts per 365 days) so we never waste a system slot.
 */
export const DEFAULT_POLICY: IReviewPolicy = {
  minDaysSinceInstall: 3,
  minLaunchCount: 5,
  minKeyActionCount: 3,
  minDaysSinceLastRequest: 90,
  maxRequestsPerYear: 3,
  cooldownAfterLaunchSec: 120,
  blockAfterErrorWindowMin: 5,
};

/**
 * Returns true only when EVERY gate passes. Pure function — depends only on the
 * snapshot, the caller-provided context, and the policy. Never calls into the
 * store or native modules, so it is fully unit-testable in a node environment.
 *
 * Note: a true result means "policy passed, attempt the request". It does NOT
 * guarantee the OS actually shows the dialog — `requestReview()` is fire-and-forget.
 */
export const canRequestReview = (
  state: IReviewSnapshot,
  ctx: ICanRequestContext,
  policy: IReviewPolicy = DEFAULT_POLICY,
): boolean => {
  // UI must be idle (no modal/transition/form/async work).
  if (!ctx.uiIsIdle) return false;
  // One request per session.
  if (state.requestedThisSession) return false;
  // Don't ask a freshly installed app.
  if (dayjs().diff(dayjs(state.installedAt), 'day') < policy.minDaysSinceInstall) {
    return false;
  }
  // Require repeated usage, not a single launch.
  if (state.launchCount < policy.minLaunchCount) return false;
  // Require repeated key actions (real engagement).
  if (state.keyActionCount < policy.minKeyActionCount) return false;
  // Block "right after launch" exposure (HIG).
  if (
    dayjs().diff(dayjs(state.sessionStartedAt), 'second') <
    policy.cooldownAfterLaunchSec
  ) {
    return false;
  }
  // Protect the iOS system quota window.
  if (
    state.lastRequestedAt &&
    dayjs().diff(dayjs(state.lastRequestedAt), 'day') <
      policy.minDaysSinceLastRequest
  ) {
    return false;
  }
  // Hard cap our own calls within a rolling year.
  const oneYearAgo = dayjs().subtract(1, 'year');
  const requestsInLastYear = state.requestHistory.filter((iso) =>
    dayjs(iso).isAfter(oneYearAgo),
  ).length;
  if (requestsInLastYear >= policy.maxRequestsPerYear) return false;
  // Never ask right after a negative moment (error/crash).
  if (
    state.lastErrorAt &&
    dayjs().diff(dayjs(state.lastErrorAt), 'minute') <
      policy.blockAfterErrorWindowMin
  ) {
    return false;
  }
  return true;
};

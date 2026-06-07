/**
 * Persisted review counters/timestamps (data only — no actions).
 * Kept separate from store actions so the policy engine stays pure and testable.
 * All timestamps are ISO strings (see CLAUDE.md date rules).
 */
export interface IReviewSnapshot {
  /** ISO timestamp of first launch (set once, persisted). */
  installedAt: string;
  /** ISO timestamp of the current session start (updated each launch, not persisted). */
  sessionStartedAt: string;
  /** Cumulative app launches. */
  launchCount: number;
  /** Cumulative key-action completions. */
  keyActionCount: number;
  /** ISO timestamp of the last review request, or null. */
  lastRequestedAt: string | null;
  /** ISO timestamp of the last error/crash, or null. */
  lastErrorAt: string | null;
  /** ISO timestamps of self-initiated requests (pruned to the last year). */
  requestHistory: string[];
  /** True once a request was attempted in this session. */
  requestedThisSession: boolean;
}

export interface IReviewActions {
  recordLaunch: () => void;
  recordKeyAction: () => void;
  recordError: () => void;
  markRequested: () => void;
  resetSession: () => void;
}

export type IReviewState = IReviewSnapshot & IReviewActions;

/**
 * Gate thresholds for the review policy engine. See DEFAULT_POLICY for the
 * mandated defaults (mirrors iOS system quota: max 3 prompts / 365 days).
 */
export interface IReviewPolicy {
  minDaysSinceInstall: number;
  minLaunchCount: number;
  minKeyActionCount: number;
  minDaysSinceLastRequest: number;
  maxRequestsPerYear: number;
  cooldownAfterLaunchSec: number;
  blockAfterErrorWindowMin: number;
}

/** Caller-provided runtime context the store cannot infer on its own. */
export interface ICanRequestContext {
  /** Caller guarantees no modal/transition/form-input/async work is in flight. */
  uiIsIdle: boolean;
}

export interface IMaybeRequestOptions {
  /** Caller guarantees the UI is idle at the call site. */
  uiIsIdle: boolean;
}

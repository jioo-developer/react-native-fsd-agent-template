/**
 * Review trigger catalog. These are EXAMPLES — replace/extend them with the
 * concrete positive-moment triggers defined in your PRD's "Review Triggers"
 * section. Trigger IDs MUST come from this constant (no magic strings).
 */
export const REVIEW_TRIGGERS = {
  AFTER_KEY_ACTION_COMPLETE: 'after_key_action_complete',
  AFTER_TASK_COMPLETE: 'after_task_complete',
  AFTER_PREMIUM_UNLOCK: 'after_premium_unlock',
} as const;

export type TReviewTrigger =
  (typeof REVIEW_TRIGGERS)[keyof typeof REVIEW_TRIGGERS];

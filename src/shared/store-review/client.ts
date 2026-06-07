import * as StoreReview from 'expo-store-review';

/** True when the platform can show a review dialog (iOS/Android In-App Review). */
export const isReviewAvailable = (): Promise<boolean> =>
  StoreReview.isAvailableAsync();

/**
 * Fire-and-forget. iOS (SKStoreReviewController) and Android (Play In-App
 * Review) may silently ignore the call when over quota — it returns no display
 * signal, so callers MUST NOT branch any follow-up UI on it.
 */
export const requestReview = (): Promise<void> => StoreReview.requestReview();

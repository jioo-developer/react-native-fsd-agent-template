import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import dayjs from 'dayjs';
import type { IReviewState } from './types';

// Counters are NON-SENSITIVE — AsyncStorage persist is correct here (no SecureStore).
const nowIso = (): string => new Date().toISOString();
const oneYearAgo = () => dayjs().subtract(1, 'year');

export const useReviewStore = create<IReviewState>()(
  persist(
    (set, get) => ({
      installedAt: nowIso(),
      sessionStartedAt: nowIso(),
      launchCount: 0,
      keyActionCount: 0,
      lastRequestedAt: null,
      lastErrorAt: null,
      requestHistory: [],
      requestedThisSession: false,

      // Call once per app launch (after rehydrate). Starts a fresh session.
      recordLaunch: () =>
        set((s) => ({
          launchCount: s.launchCount + 1,
          sessionStartedAt: nowIso(),
          requestedThisSession: false,
        })),

      // Call from a positive key-action success callback.
      recordKeyAction: () =>
        set((s) => ({ keyActionCount: s.keyActionCount + 1 })),

      // Call from the global error boundary / Crashlytics handler.
      recordError: () => set({ lastErrorAt: nowIso() }),

      // Call right before firing requestReview(). Prunes year-old entries.
      markRequested: () => {
        const stamp = nowIso();
        const pruned = get().requestHistory.filter((iso) =>
          dayjs(iso).isAfter(oneYearAgo()),
        );
        set({
          lastRequestedAt: stamp,
          requestedThisSession: true,
          requestHistory: [...pruned, stamp],
        });
      },

      resetSession: () => set({ requestedThisSession: false }),
    }),
    {
      name: 'review-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Session-scoped fields stay ephemeral; only durable counters persist.
      partialize: (s) => ({
        installedAt: s.installedAt,
        launchCount: s.launchCount,
        keyActionCount: s.keyActionCount,
        lastRequestedAt: s.lastRequestedAt,
        lastErrorAt: s.lastErrorAt,
        requestHistory: s.requestHistory,
      }),
    },
  ),
);

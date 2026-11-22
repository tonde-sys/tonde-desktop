// ============================================================
// TONDE DESKTOP — Counter Store (Zustand)
// Le guichet ouvert est persisté pour reprendre le service
// après un redémarrage de l'application.
// ============================================================

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Counter } from "../types";
import { apiService, ApiError } from "../services/api/apiService";
import { useOfflineStore } from "./offlineStore";
import { useAppStore } from "./app.store";
import { db } from "../services/database/db";

interface CounterState {
  myCounter: Counter | null;
  allCounters: Counter[];
  isLoading: boolean;

  // Actions
  loadMyCounter: (counterId: string) => Promise<void>;
  loadAllCounters: (branchId: string) => Promise<void>;
  pauseCounter: (counterId: string, pausedUntil?: string) => Promise<void>;
  resumeCounter: (counterId: string) => Promise<void>;
  closeCounter: (counterId: string) => Promise<void>;
  openCounter: (counterId: string, agentId: string) => Promise<boolean>;
  updateCounterFromWS: (counter: Counter) => void;
  getCountersByService: (serviceId: string) => Counter[];
  reset: () => void;
}

function notifyError(title: string, message?: string): void {
  useAppStore.getState().addNotification({
    type: "error",
    title,
    message,
  });
}

export const useCounterStore = create<CounterState>()(
  persist(
    (set, get) => ({
      myCounter: null,
      allCounters: [],
      isLoading: false,

      loadMyCounter: async (counterId) => {
        set({ isLoading: true });
        try {
          const counter = await apiService.getCounter(counterId);
          // La pause ferme le guichet côté serveur : on conserve l'état
          // "en pause" local pour proposer une reprise rapide au redémarrage.
          const previous = get().myCounter;
          const merged: Counter =
            previous?.status === "PAUSED" && counter.status === "CLOSED"
              ? { ...counter, status: "PAUSED" }
              : counter;
          await db.upsertCounter(merged);
          set({ myCounter: merged, isLoading: false });
        } catch {
          const cached = await db.getCounter(counterId);
          set({ myCounter: cached, isLoading: false });
        }
      },

      loadAllCounters: async (branchId) => {
        set({ isLoading: true });
        try {
          const counters = await apiService.getCounters(branchId);
          await db.cacheCounters(counters);
          set({ allCounters: counters, isLoading: false });
        } catch {
          const cached = await db.getCachedCounters(branchId);
          set({ allCounters: cached, isLoading: false });
        }
      },

      pauseCounter: async (counterId, pausedUntil) => {
        const { isOnline, enqueue } = useOfflineStore.getState();
        const current = get().myCounter;

        set((state) => ({
          myCounter: state.myCounter
            ? {
                ...state.myCounter,
                status: "PAUSED",
                paused_until: pausedUntil ?? null,
              }
            : null,
          allCounters: state.allCounters.map((c) =>
            c.id === counterId
              ? { ...c, status: "PAUSED", paused_until: pausedUntil ?? null }
              : c
          ),
        }));
        if (current) {
          await db.upsertCounter({
            ...current,
            status: "PAUSED",
            paused_until: pausedUntil ?? null,
          });
        }

        if (isOnline) {
          try {
            await apiService.pauseCounter(counterId, pausedUntil);
          } catch {
            await enqueue("PAUSE_COUNTER", {
              counter_id: counterId,
              paused_until: pausedUntil ?? null,
            });
          }
        } else {
          await enqueue("PAUSE_COUNTER", {
            counter_id: counterId,
            paused_until: pausedUntil ?? null,
          });
        }
      },

      resumeCounter: async (counterId) => {
        const { isOnline, enqueue } = useOfflineStore.getState();
        const current = get().myCounter;

        set((state) => ({
          myCounter: state.myCounter
            ? { ...state.myCounter, status: "OPEN", paused_until: null }
            : null,
          allCounters: state.allCounters.map((c) =>
            c.id === counterId
              ? { ...c, status: "OPEN", paused_until: null }
              : c
          ),
        }));
        if (current) {
          await db.upsertCounter({
            ...current,
            status: "OPEN",
            paused_until: null,
          });
        }

        if (isOnline) {
          try {
            await apiService.resumeCounter(counterId);
          } catch {
            await enqueue("RESUME_COUNTER", { counter_id: counterId });
          }
        } else {
          await enqueue("RESUME_COUNTER", { counter_id: counterId });
        }
      },

      closeCounter: async (counterId) => {
        try {
          await apiService.closeCounter(counterId);
        } catch {
          // Le serveur est peut-être injoignable : la fermeture sera
          // rejouée par l'outbox, le logout ne doit pas être bloqué.
          await useOfflineStore
            .getState()
            .enqueue("CLOSE_COUNTER", { counter_id: counterId });
        }

        const current = get().myCounter;
        if (current) {
          await db.upsertCounter({ ...current, status: "CLOSED" });
        }
        set((state) => ({
          myCounter:
            state.myCounter?.id === counterId
              ? { ...state.myCounter, status: "CLOSED" }
              : state.myCounter,
          allCounters: state.allCounters.map((c) =>
            c.id === counterId ? { ...c, status: "CLOSED" } : c
          ),
        }));
      },

      openCounter: async (counterId, agentId) => {
        const existing = get().allCounters.find((c) => c.id === counterId);

        try {
          await apiService.openCounter(counterId, agentId);
        } catch (err) {
          if (useOfflineStore.getState().isOnline) {
            if (err instanceof ApiError && err.code === "COUNTER_ALREADY_OPEN") {
              useAppStore.getState().addNotification({
                type: "info",
                title: "Guichet déjà ouvert",
                message: "Session reprise sur ce guichet.",
              });
            } else {
              notifyError(
                "Ouverture du guichet impossible",
                err instanceof Error ? err.message : undefined
              );
              return false;
            }
          } else {
            // Hors-ligne : ouverture locale, rejouée à la reconnexion.
            await useOfflineStore
              .getState()
              .enqueue("OPEN_COUNTER", {
                counter_id: counterId,
                agent_id: agentId,
              });
          }
        }

        const base: Counter = existing ?? {
          id: counterId,
          number: 0,
          name: "Guichet",
          status: "OPEN",
          service_ids: [],
          branch_id: "",
        };
        const opened: Counter = { ...base, status: "OPEN", agent_id: agentId };

        await db.upsertCounter(opened);
        set((state) => ({
          myCounter: opened,
          allCounters: state.allCounters.map((c) =>
            c.id === counterId
              ? { ...c, status: "OPEN", agent_id: agentId }
              : c
          ),
        }));
        return true;
      },

      updateCounterFromWS: (counter) =>
        set((state) => ({
          myCounter:
            state.myCounter?.id === counter.id
              ? { ...state.myCounter, ...counter }
              : state.myCounter,
          allCounters: state.allCounters.map((c) =>
            c.id === counter.id ? { ...c, ...counter } : c
          ),
        })),

      getCountersByService: (serviceId) =>
        get().allCounters.filter((c) => c.service_ids.includes(serviceId)),

      reset: () =>
        set({ myCounter: null, allCounters: [], isLoading: false }),
    }),
    {
      name: "tonde-counter",
      partialize: (state) => ({ myCounter: state.myCounter }),
    }
  )
);

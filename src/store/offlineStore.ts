// ============================================================
// TONDE DESKTOP — Offline Store (Zustand)
// Gestion des actions hors ligne et synchronisation
// ============================================================

import { create } from "zustand";
import type { SyncQueueItem, SyncActionType, ConnectionStatus } from "../types";
import { db } from "../services/database/db";
import { apiService } from "../services/api/apiService";
import { nanoid } from "nanoid";

interface OfflineState {
  isOnline: boolean;
  connectionStatus: ConnectionStatus;
  syncQueue: SyncQueueItem[];
  isSyncing: boolean;
  lastSyncAt: string | null;
  actor: { userId: string; branchId: string } | null;

  // Actions
  setOnline: (online: boolean) => Promise<void>;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setActor: (actor: { userId: string; branchId: string } | null) => void;
  enqueue: (action: SyncActionType, payload: Record<string, unknown>) => Promise<void>;
  syncPending: () => Promise<void>;
  loadSyncQueue: () => Promise<void>;
  clearCompleted: () => Promise<void>;
  retryItem: (id: string) => Promise<void>;
  dismissItem: (id: string) => Promise<void>;

  // Helpers
  getPendingCount: () => number;
  getFailedCount: () => number;
  hasPending: () => boolean;
}

/** Une action appartient à l'agent qui l'a créée (les anciennes n'ont pas de tag). */
export function belongsToActor(
  item: SyncQueueItem,
  actor: { userId: string } | null
): boolean {
  const itemUser = item.payload.user_id;
  if (typeof itemUser !== "string") return true;
  return actor !== null && itemUser === actor.userId;
}

export const useOfflineStore = create<OfflineState>()((set, get) => ({
  isOnline: navigator.onLine,
  connectionStatus: "DISCONNECTED",
  syncQueue: [],
  isSyncing: false,
  lastSyncAt: null,
  actor: null,

  setOnline: async (online) => {
    const wasOffline = !get().isOnline;
    set({ isOnline: online, connectionStatus: online ? "CONNECTED" : "DISCONNECTED" });
    // Auto-sync when coming back online
    if (online && wasOffline) {
      await get().syncPending();
    }
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  setActor: (actor) => set({ actor }),

  enqueue: async (action, payload) => {
    const actor = get().actor;
    const item: SyncQueueItem = {
      id: nanoid(),
      action,
      // L'action est rattachée à l'agent courant : elle ne sera jamais
      // rejouée par un autre agent sur le même poste.
      payload: {
        ...payload,
        ...(actor
          ? { user_id: actor.userId, branch_id: actor.branchId }
          : {}),
      },
      created_at: new Date().toISOString(),
      status: "PENDING",
      retry_count: 0,
    };
    await db.insertSyncItem(item);
    set((state) => ({ syncQueue: [...state.syncQueue, item] }));

    // Un timeout peut laisser l'action en attente alors que le réseau est
    // bon : on retente automatiquement sans attendre un cycle offline→online.
    if (get().isOnline) {
      setTimeout(() => {
        if (get().isOnline) void get().syncPending();
      }, 5_000);
    }
  },

  syncPending: async () => {
    const { isSyncing, syncQueue, actor } = get();
    if (isSyncing || !actor) return;

    // Seuls les PENDING de l'agent courant sont rejoués : un FAILED a déjà
    // épuisé ses tentatives et ne doit pas boucler indéfiniment.
    const pending = syncQueue.filter(
      (i) => i.status === "PENDING" && belongsToActor(i, actor)
    );
    if (pending.length === 0) return;

    set({ isSyncing: true });

    for (const item of pending) {
      set((state) => ({
        syncQueue: state.syncQueue.map((i) =>
          i.id === item.id ? { ...i, status: "SYNCING" } : i
        ),
      }));
      await db.updateSyncItemStatus(item.id, "SYNCING");

      try {
        await dispatchSyncAction(item);
        const done: SyncQueueItem = {
          ...item,
          status: "DONE",
          synced_at: new Date().toISOString(),
          error: undefined,
        };
        await db.updateSyncItemStatus(
          item.id,
          "DONE",
          done.synced_at,
          item.retry_count
        );
        set((state) => ({
          syncQueue: state.syncQueue.map((i) => (i.id === item.id ? done : i)),
        }));
      } catch (err) {
        const retryCount = item.retry_count + 1;
        const message =
          err instanceof Error ? err.message : "Échec de synchronisation";
        const failed: SyncQueueItem = {
          ...item,
          status: retryCount >= 3 ? "FAILED" : "PENDING",
          retry_count: retryCount,
          error: message,
        };
        await db.updateSyncItemStatus(
          item.id,
          failed.status,
          undefined,
          retryCount,
          message
        );
        set((state) => ({
          syncQueue: state.syncQueue.map((i) => (i.id === item.id ? failed : i)),
        }));
      }
    }

    set({ isSyncing: false, lastSyncAt: new Date().toISOString() });
  },

  loadSyncQueue: async () => {
    const items = await db.getSyncQueue();
    const recovered: SyncQueueItem[] = [];
    for (const item of items) {
      if (item.status === "DONE") continue;
      if (item.status === "SYNCING") {
        // Crash en pleine synchronisation : l'action redevient PENDING.
        // Les commandes backend sont idempotentes par ticket.
        await db.updateSyncItemStatus(item.id, "PENDING");
        recovered.push({ ...item, status: "PENDING" });
      } else {
        recovered.push(item);
      }
    }
    // Les actions déjà appliquées n'ont pas besoin d'être conservées.
    await db.clearDoneSyncItems();
    set({ syncQueue: recovered });
  },

  clearCompleted: async () => {
    await db.clearDoneSyncItems();
    set((state) => ({
      syncQueue: state.syncQueue.filter((i) => i.status !== "DONE"),
    }));
  },

  retryItem: async (id) => {
    const { syncQueue, actor } = get();
    const item = syncQueue.find((i) => i.id === id);
    if (!item || item.status !== "FAILED" || !belongsToActor(item, actor)) return;

    await db.updateSyncItemStatus(id, "PENDING", undefined, 0, undefined);
    set((state) => ({
      syncQueue: state.syncQueue.map((i) =>
        i.id === id
          ? { ...i, status: "PENDING", retry_count: 0, error: undefined }
          : i
      ),
    }));
    // Hors connexion, l'action repartira au retour du réseau.
    if (get().isOnline) {
      await get().syncPending();
    }
  },

  dismissItem: async (id) => {
    const { syncQueue, actor } = get();
    const item = syncQueue.find((i) => i.id === id);
    if (!item || !belongsToActor(item, actor)) return;

    await db.updateSyncItemStatus(
      id,
      "DONE",
      new Date().toISOString(),
      item.retry_count
    );
    set((state) => ({
      syncQueue: state.syncQueue.filter((i) => i.id !== id),
    }));
  },

  getPendingCount: () => {
    const { syncQueue, actor } = get();
    return syncQueue.filter(
      (i) =>
        (i.status === "PENDING" || i.status === "SYNCING") &&
        belongsToActor(i, actor)
    ).length;
  },

  getFailedCount: () => {
    const { syncQueue, actor } = get();
    return syncQueue.filter(
      (i) => i.status === "FAILED" && belongsToActor(i, actor)
    ).length;
  },

  hasPending: () => get().getPendingCount() > 0,
}));

// ---- Dispatch individual sync actions to API ----
async function dispatchSyncAction(item: SyncQueueItem): Promise<void> {
  const p = item.payload;
  switch (item.action) {
    case "CALL_TICKET":
      await apiService.callTicketById(p.ticket_id as string, p.counter_id as string);
      break;
    case "START_SERVING":
      await apiService.startServingTicket(p.ticket_id as string, p.counter_id as string);
      break;
    case "RECALL_TICKET":
      await apiService.recallTicket(p.ticket_id as string, p.counter_id as string);
      break;
    case "MARK_ABSENT":
      await apiService.markTicketAbsent(p.ticket_id as string, p.counter_id as string);
      break;
    case "MARK_INCOMPLETE":
      await apiService.markTicketIncomplete(
        p.ticket_id as string,
        p.counter_id as string,
        p.reason as string | undefined
      );
      break;
    case "COMPLETE_TICKET":
      await apiService.completeTicket(p.ticket_id as string, p.counter_id as string);
      break;
    case "TRANSFER_TICKET":
      await apiService.transferTicket(
        p.ticket_id as string,
        p.to_counter_id as string,
        p.to_service_id as string
      );
      break;
    case "PAUSE_COUNTER":
      await apiService.pauseCounter(p.counter_id as string);
      break;
    case "RESUME_COUNTER":
      await apiService.resumeCounter(p.counter_id as string);
      break;
    case "OPEN_COUNTER":
      // Rejeu après coupure : l'ouverture a peut-être déjà abouti.
      await apiService.openCounter(
        p.counter_id as string,
        p.agent_id as string,
        true
      );
      break;
    case "CLOSE_COUNTER":
      await apiService.closeCounter(p.counter_id as string);
      break;
    default:
      throw new Error(`Unknown sync action: ${item.action}`);
  }
}

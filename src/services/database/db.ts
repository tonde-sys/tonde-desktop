// ============================================================
// TONDE DESKTOP — SQLite Database Service
// Enveloppe tolérante des commandes Tauri db_* :
// - hors runtime Tauri (navigateur dev / tests) → valeurs neutres
// - erreur d'une commande → avertissement, jamais de crash UI
// ============================================================

import { invoke } from "@tauri-apps/api/core";
import type {
  Ticket,
  Counter,
  Employee,
  Queue,
  Service,
  SyncQueueItem,
  SyncStatus,
} from "../../types";
import { isTauriRuntime } from "../secure/tokenStorage";

async function safeInvoke<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  fallback: T
): Promise<T> {
  if (!isTauriRuntime()) return fallback;
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    console.warn(`[TONDE] Commande ${command} indisponible`, err);
    return fallback;
  }
}

export const db = {
  // ---- Tickets ----

  async upsertTicket(ticket: Ticket): Promise<void> {
    await safeInvoke<void>("db_upsert_ticket", { ticket }, undefined);
  },

  async getTicket(id: string): Promise<Ticket | null> {
    return safeInvoke<Ticket | null>("db_get_ticket", { id }, null);
  },

  async getNextWaitingTicket(serviceIds: string[]): Promise<Ticket | null> {
    return safeInvoke<Ticket | null>(
      "db_get_next_waiting_ticket",
      { serviceIds },
      null
    );
  },

  async getTicketsByStatus(branchId: string, status: string): Promise<Ticket[]> {
    return safeInvoke<Ticket[]>(
      "db_get_tickets_by_status",
      { branchId, status },
      []
    );
  },

  // ---- Counters ----

  async upsertCounter(counter: Counter): Promise<void> {
    await safeInvoke<void>("db_upsert_counter", { counter }, undefined);
  },

  async getCounter(id: string): Promise<Counter | null> {
    return safeInvoke<Counter | null>("db_get_counter", { id }, null);
  },

  async cacheCounters(counters: Counter[]): Promise<void> {
    await safeInvoke<void>("db_cache_counters", { counters }, undefined);
  },

  async getCachedCounters(branchId: string): Promise<Counter[]> {
    return safeInvoke<Counter[]>("db_get_cached_counters", { branchId }, []);
  },

  // ---- Employees ----

  async upsertEmployee(
    employee: Omit<Employee, "counter_id" | "avatar_url">
  ): Promise<void> {
    await safeInvoke<void>("db_upsert_employee", { employee }, undefined);
  },

  async getEmployeeByEmail(email: string): Promise<Employee | null> {
    return safeInvoke<Employee | null>(
      "db_get_employee_by_email",
      { email },
      null
    );
  },

  async getEmployeesByBranch(branchId: string): Promise<Employee[]> {
    return safeInvoke<Employee[]>(
      "db_get_employees_by_branch",
      { branchId },
      []
    );
  },

  // ---- Queues & services ----

  async cacheQueues(queues: Queue[], branchId: string): Promise<void> {
    await safeInvoke<void>("db_cache_queues", { queues, branchId }, undefined);
  },

  async getCachedQueues(branchId: string): Promise<Queue[]> {
    return safeInvoke<Queue[]>("db_get_cached_queues", { branchId }, []);
  },

  async cacheServices(services: Service[], branchId: string): Promise<void> {
    await safeInvoke<void>(
      "db_cache_services",
      { services, branchId },
      undefined
    );
  },

  async getCachedServices(branchId: string): Promise<Service[]> {
    return safeInvoke<Service[]>("db_get_cached_services", { branchId }, []);
  },

  // ---- Sync Queue (outbox) ----

  async insertSyncItem(item: SyncQueueItem): Promise<void> {
    await safeInvoke<void>("db_insert_sync_item", { item }, undefined);
  },

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    return safeInvoke<SyncQueueItem[]>("db_get_sync_queue", undefined, []);
  },

  async updateSyncItemStatus(
    id: string,
    status: SyncStatus,
    syncedAt?: string,
    retryCount?: number,
    error?: string
  ): Promise<void> {
    await safeInvoke<void>(
      "db_update_sync_item_status",
      { id, status, syncedAt, retryCount, error },
      undefined
    );
  },

  async clearDoneSyncItems(): Promise<void> {
    await safeInvoke<void>("db_clear_done_sync_items", undefined, undefined);
  },

  // ---- Maintenance ----

  async runMigrations(): Promise<void> {
    await safeInvoke<void>("db_run_migrations", undefined, undefined);
  },

  async vacuum(): Promise<void> {
    await safeInvoke<void>("db_vacuum", undefined, undefined);
  },
};

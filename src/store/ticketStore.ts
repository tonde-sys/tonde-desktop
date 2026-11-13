// ============================================================
// TONDE DESKTOP — Ticket Store (Zustand)
// Actions optimistes (<200 ms), repli offline via outbox,
// toasts d'erreur et rafraîchissement de la file après mutation.
// ============================================================

import { create } from "zustand";
import type { Ticket, TicketStatus } from "../types";
import { apiService, ApiError } from "../services/api/apiService";
import { useOfflineStore } from "./offlineStore";
import { useAppStore } from "./app.store";
import { useQueueStore } from "./queueStore";
import { useCounterStore } from "./counterStore";
import { canTransition } from "../utils/ticket-state-machine";
import { playAlertSound, playCallSound } from "../utils/sound";
import { db } from "../services/database/db";

interface TicketState {
  currentTicket: Ticket | null;
  processingStartedAt: string | null;
  recentTickets: Ticket[];
  isLoading: boolean;
  error: string | null;

  // Core Agent Actions
  callNext: (counterId: string, serviceIds: string[]) => Promise<void>;
  recall: (counterId: string) => Promise<void>;
  markAbsent: (ticketId: string, counterId: string) => Promise<void>;
  complete: (ticketId: string, counterId: string) => Promise<void>;
  transfer: (ticketId: string, toCounterId: string, toServiceId: string) => Promise<boolean>;

  // State helpers
  setCurrentTicket: (ticket: Ticket | null) => void;
  restoreCurrentTicket: (ticketId: string) => Promise<void>;
  updateTicketStatus: (ticketId: string, status: TicketStatus) => void;
  clearError: () => void;
  reset: () => void;
  getProcessingDuration: () => number;
}

type NotificationType = "info" | "success" | "warning" | "error";

function notify(type: NotificationType, title: string, message?: string): void {
  useAppStore.getState().addNotification({ type, title, message });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Erreur inattendue";
}

/** Erreur réseau/timeout : le backend n'a pas pu être joint. */
function isNetworkFailure(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0 && err.code === "NETWORK";
}

/** Délai dépassé : le serveur a peut-être appliqué l'action. */
function isTimeoutFailure(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0 && err.code === "TIMEOUT";
}

/**
 * Après un timeout sur call-next, le serveur a pu attribuer un ticket.
 * On adopte l'état réel du guichet au lieu d'inventer un ticket local.
 */
async function reconcileCounterTicket(counterId: string): Promise<Ticket | null> {
  try {
    const counter = await apiService.getCounter(counterId);
    if (!counter.current_ticket_id) return null;
    const ticket = await apiService.getTicket(counter.current_ticket_id);
    if (
      ticket.status === "COMPLETED" ||
      ticket.status === "ABSENT" ||
      ticket.status === "CANCELLED"
    ) {
      return null;
    }
    return ticket;
  } catch {
    return null;
  }
}

function refreshQueues(): void {
  const branchId = useCounterStore.getState().myCounter?.branch_id;
  if (branchId) {
    void useQueueStore.getState().loadQueues(branchId);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useTicketStore = create<TicketState>()((set, get) => ({
  currentTicket: null,
  processingStartedAt: null,
  recentTickets: [],
  isLoading: false,
  error: null,

  callNext: async (counterId, serviceIds) => {
    if (get().isLoading) return;

    if (!useOfflineStore.getState().isOnline) {
      notify(
        "warning",
        "Appel indisponible hors ligne",
        "Terminez le ticket en cours ; l'appel reprendra au retour du réseau."
      );
      return;
    }

    const previousTicket = get().currentTicket;
    const previousStartedAt = get().processingStartedAt;

    set({ isLoading: true, error: null });

    try {
      const ticket = await apiService.callNextTicket(counterId, serviceIds);
      await db.upsertTicket(ticket);
      set({
        currentTicket: ticket,
        processingStartedAt: nowIso(),
        error: null,
      });
      void playCallSound();
      refreshQueues();
    } catch (err) {
      if (isTimeoutFailure(err)) {
        // Réponse perdue : on demande au serveur quel ticket est réellement
        // en cours avant d'afficher quoi que ce soit.
        const adopted = await reconcileCounterTicket(counterId);
        if (adopted) {
          await db.upsertTicket(adopted);
          set({
            currentTicket: adopted,
            processingStartedAt: nowIso(),
            error: null,
          });
          void playCallSound();
          refreshQueues();
          notify(
            "warning",
            "Réponse lente",
            "Le ticket affiché a été confirmé par le serveur."
          );
          return;
        }
        set({
          currentTicket: previousTicket,
          processingStartedAt: previousStartedAt,
          error: "Aucun ticket confirmé par le serveur.",
        });
        refreshQueues();
        notify(
          "warning",
          "Réponse incertaine",
          "Aucun ticket n'a été confirmé par le serveur. Vérifiez la file avant de réessayer."
        );
        return;
      }

      if (isNetworkFailure(err)) {
        useOfflineStore.getState().setOnline(false);
        set({
          currentTicket: previousTicket,
          processingStartedAt: previousStartedAt,
          error: "Serveur injoignable.",
        });
        notify(
          "error",
          "Appel impossible",
          "Serveur injoignable. L'appel d'un nouveau ticket reprendra au retour du réseau."
        );
        return;
      }

      set({
        currentTicket: previousTicket,
        processingStartedAt: previousStartedAt,
        error: errorMessage(err),
      });
      notify("error", "Appel impossible", errorMessage(err));
    } finally {
      set({ isLoading: false });
    }
  },

  recall: async (counterId) => {
    const { currentTicket } = get();
    if (!currentTicket || get().isLoading) {
      if (!currentTicket) notify("warning", "Aucun ticket en cours");
      return;
    }

    set({ isLoading: true });

    try {
      if (useOfflineStore.getState().isOnline) {
        try {
          await apiService.recallTicket(currentTicket.id, counterId);
        } catch (err) {
          if (isNetworkFailure(err)) {
            useOfflineStore.getState().setOnline(false);
          } else if (!isTimeoutFailure(err)) {
            throw err;
          }
          await useOfflineStore.getState().enqueue("RECALL_TICKET", {
            ticket_id: currentTicket.id,
            counter_id: counterId,
          });
        }
      } else {
        await useOfflineStore.getState().enqueue("RECALL_TICKET", {
          ticket_id: currentTicket.id,
          counter_id: counterId,
        });
      }
      void playCallSound();
    } catch (err) {
      notify("error", "Rappel impossible", errorMessage(err));
    } finally {
      set({ isLoading: false });
    }
  },

  markAbsent: async (ticketId, counterId) => {
    const ticket = get().currentTicket;
    if (!ticket || get().isLoading) {
      if (!ticket) notify("warning", "Aucun ticket en cours");
      return;
    }
    if (!canTransition(ticket.status, "ABSENT")) {
      notify(
        "warning",
        "Action impossible",
        `Le ticket ${ticket.number} est au statut ${ticket.status}.`
      );
      return;
    }

    const previousStartedAt = get().processingStartedAt;
    set({
      isLoading: true,
      error: null,
      currentTicket: null,
      processingStartedAt: null,
    });
    void playAlertSound();

    const closeInCache = async (): Promise<void> => {
      const updated: Ticket = {
        ...ticket,
        status: "ABSENT",
        closed_at: nowIso(),
      };
      await db.upsertTicket(updated);
      await useOfflineStore.getState().enqueue("MARK_ABSENT", {
        ticket_id: ticketId,
        counter_id: counterId,
      });
    };

    try {
      if (useOfflineStore.getState().isOnline) {
        try {
          await apiService.markTicketAbsent(ticketId, counterId);
          refreshQueues();
          notify("info", `Ticket ${ticket.number} marqué absent`);
          return;
        } catch (err) {
          if (isNetworkFailure(err)) {
            useOfflineStore.getState().setOnline(false);
          } else if (!isTimeoutFailure(err)) {
            throw err;
          }
        }
      }

      await closeInCache();
      notify(
        "warning",
        "Absence enregistrée",
        "Synchronisation automatique en attente."
      );
    } catch (err) {
      set({
        currentTicket: ticket,
        processingStartedAt: previousStartedAt,
      });
      notify("error", "Impossible de marquer absent", errorMessage(err));
    } finally {
      set({ isLoading: false });
    }
  },

  complete: async (ticketId, counterId) => {
    const ticket = get().currentTicket;
    if (!ticket || get().isLoading) {
      if (!ticket) notify("warning", "Aucun ticket en cours");
      return;
    }
    if (!canTransition(ticket.status, "COMPLETED")) {
      notify(
        "warning",
        "Action impossible",
        `Le ticket ${ticket.number} est au statut ${ticket.status}.`
      );
      return;
    }

    const previousStartedAt = get().processingStartedAt;
    set({
      isLoading: true,
      error: null,
      currentTicket: null,
      processingStartedAt: null,
    });

    const closeInCache = async (): Promise<Ticket> => {
      const updated: Ticket = {
        ...ticket,
        status: "COMPLETED",
        closed_at: nowIso(),
      };
      await db.upsertTicket(updated);
      await useOfflineStore.getState().enqueue("COMPLETE_TICKET", {
        ticket_id: ticketId,
        counter_id: counterId,
      });
      return updated;
    };

    try {
      let closed: Ticket | null = null;

      if (useOfflineStore.getState().isOnline) {
        try {
          await apiService.completeTicket(ticketId, counterId);
          closed = { ...ticket, status: "COMPLETED", closed_at: nowIso() };
          await db.upsertTicket(closed);
          refreshQueues();
        } catch (err) {
          if (isNetworkFailure(err)) {
            useOfflineStore.getState().setOnline(false);
          } else if (!isTimeoutFailure(err)) {
            throw err;
          }
        }
      }

      if (!closed) {
        closed = await closeInCache();
        notify(
          "warning",
          "Clôture enregistrée",
          "Synchronisation automatique en attente."
        );
      } else {
        notify("success", `Ticket ${ticket.number} clôturé`);
      }

      set((state) => ({
        recentTickets: [closed as Ticket, ...state.recentTickets.slice(0, 9)],
      }));
    } catch (err) {
      set({
        currentTicket: ticket,
        processingStartedAt: previousStartedAt,
      });
      notify("error", "Clôture impossible", errorMessage(err));
    } finally {
      set({ isLoading: false });
    }
  },

  transfer: async (ticketId, toCounterId, toServiceId) => {
    const ticket = get().currentTicket;
    if (!ticket || ticket.id !== ticketId || get().isLoading) {
      if (!ticket) notify("warning", "Aucun ticket en cours");
      return false;
    }

    const previousStartedAt = get().processingStartedAt;
    set({
      isLoading: true,
      error: null,
      currentTicket: null,
      processingStartedAt: null,
    });

    const targetName =
      useQueueStore
        .getState()
        .services.find((s) => s.id === toServiceId)?.name ??
      "le service cible";

    try {
      if (useOfflineStore.getState().isOnline) {
        try {
          await apiService.transferTicket(
            ticketId,
            toCounterId,
            toServiceId
          );
          refreshQueues();
          notify(
            "success",
            `Ticket ${ticket.number} transféré`,
            `Redirigé vers ${targetName}.`
          );
          return true;
        } catch (err) {
          if (isNetworkFailure(err)) {
            useOfflineStore.getState().setOnline(false);
          } else if (!isTimeoutFailure(err)) {
            throw err;
          }
        }
      }

      await useOfflineStore.getState().enqueue("TRANSFER_TICKET", {
        ticket_id: ticketId,
        to_counter_id: toCounterId,
        to_service_id: toServiceId,
      });
      notify(
        "warning",
        "Transfert enregistré",
        "Synchronisation automatique en attente."
      );
      return true;
    } catch (err) {
      set({
        currentTicket: ticket,
        processingStartedAt: previousStartedAt,
      });
      notify("error", "Transfert impossible", errorMessage(err));
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  setCurrentTicket: (ticket) =>
    set({
      currentTicket: ticket,
      processingStartedAt: ticket ? nowIso() : null,
    }),

  restoreCurrentTicket: async (ticketId) => {
    if (get().currentTicket || get().isLoading) return;
    try {
      const ticket = await apiService.getTicket(ticketId);
      // Seul un ticket réellement en cours peut être repris.
      if (ticket.status !== "CALLED" && ticket.status !== "PROCESSING") return;
      await db.upsertTicket(ticket);
      set({
        currentTicket: ticket,
        processingStartedAt: ticket.called_at ?? nowIso(),
      });
    } catch {
      // Reprise best-effort : une file vide prendra le relais.
    }
  },

  updateTicketStatus: (ticketId, status) =>
    set((state) => ({
      currentTicket:
        state.currentTicket?.id === ticketId
          ? { ...state.currentTicket, status }
          : state.currentTicket,
    })),

  clearError: () => set({ error: null }),

  reset: () =>
    set({
      currentTicket: null,
      processingStartedAt: null,
      recentTickets: [],
      isLoading: false,
      error: null,
    }),

  getProcessingDuration: () => {
    const { processingStartedAt } = get();
    if (!processingStartedAt) return 0;
    return Math.floor(
      (Date.now() - new Date(processingStartedAt).getTime()) / 1000
    );
  },
}));

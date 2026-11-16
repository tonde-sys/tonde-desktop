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
import { absenceErrorMessage, canMarkAbsent, graceSecondsLeft } from "../utils/absence";
import { playAlertSound, playCallSound } from "../utils/sound";
import { db } from "../services/database/db";

interface TicketState {
  currentTicket: Ticket | null;
  processingStartedAt: string | null;
  recentTickets: Ticket[];
  heldTickets: Ticket[];
  lastRecall: { ticketId: string; recallsLeft: number } | null;
  isLoading: boolean;
  error: string | null;

  // Core Agent Actions
  callNext: (counterId: string, serviceIds: string[]) => Promise<void>;
  startServing: (ticketId: string, counterId: string) => Promise<void>;
  recall: (counterId: string) => Promise<void>;
  markAbsent: (ticketId: string, counterId: string) => Promise<void>;
  markIncomplete: (
    ticketId: string,
    counterId: string,
    reason?: string
  ) => Promise<void>;
  returnToQueue: (ticket: Ticket) => Promise<boolean>;
  closeHeldTicket: (ticketId: string, reason?: string) => Promise<boolean>;
  decidePriority: (
    ticketId: string,
    approve: boolean,
    priority?: "standard" | "priority" | "vip" | "emergency"
  ) => Promise<Ticket | null>;
  loadHeldTickets: (branchId: string) => Promise<void>;
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
  heldTickets: [],
  lastRecall: null,
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
        processingStartedAt: ticket.served_at ?? ticket.called_at ?? nowIso(),
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
            processingStartedAt:
              adopted.served_at ?? adopted.called_at ?? nowIso(),
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

  startServing: async (ticketId, counterId) => {
    const ticket = get().currentTicket;
    if (!ticket || ticket.id !== ticketId || get().isLoading) {
      if (!ticket) notify("warning", "Aucun ticket en cours");
      return;
    }
    if (!canTransition(ticket.status, "PROCESSING")) {
      notify(
        "warning",
        "Action impossible",
        `Le ticket ${ticket.number} est au statut ${ticket.status}.`
      );
      return;
    }

    const previousStartedAt = get().processingStartedAt;
    const servedAt = nowIso();
    const servingTicket: Ticket = {
      ...ticket,
      status: "PROCESSING",
      served_at: servedAt,
    };

    set({
      isLoading: true,
      error: null,
      currentTicket: servingTicket,
      processingStartedAt: servedAt,
    });

    const saveInOutbox = async (): Promise<void> => {
      await db.upsertTicket(servingTicket);
      await useOfflineStore.getState().enqueue("START_SERVING", {
        ticket_id: ticketId,
        counter_id: counterId,
      });
    };

    try {
      if (useOfflineStore.getState().isOnline) {
        try {
          await apiService.startServingTicket(ticketId, counterId);
          await db.upsertTicket(servingTicket);
          refreshQueues();
          return;
        } catch (err) {
          if (isNetworkFailure(err)) {
            useOfflineStore.getState().setOnline(false);
          } else if (!isTimeoutFailure(err)) {
            throw err;
          }
        }
      }

      await saveInOutbox();
      notify(
        "warning",
        "Prise en charge enregistrée",
        "Synchronisation automatique en attente."
      );
    } catch (err) {
      set({
        currentTicket: ticket,
        processingStartedAt: previousStartedAt,
      });
      notify("error", "Prise en charge impossible", errorMessage(err));
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
    if (currentTicket.status !== "CALLED") {
      notify("warning", "Rappel indisponible", "Seul un ticket appelé peut être relancé.");
      return;
    }
    if (!useOfflineStore.getState().isOnline) {
      notify("warning", "Rappel indisponible hors ligne", "Reconnectez-vous avant de relancer le ticket.");
      return;
    }

    set({ isLoading: true });

    try {
      const result = await apiService.recallTicket(currentTicket.id, counterId);
      set({ lastRecall: { ticketId: currentTicket.id, recallsLeft: result.recalls_left } });
      void playCallSound();
      refreshQueues();
    } catch (err) {
      if (isNetworkFailure(err)) {
        useOfflineStore.getState().setOnline(false);
      }
      if (isNetworkFailure(err) || isTimeoutFailure(err)) {
        notify(
          "warning",
          "Résultat du rappel incertain",
          "Vérifiez si le client a reçu l'appel avant de réessayer."
        );
      } else {
        notify("error", "Rappel impossible", errorMessage(err));
      }
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

    // Délai de grâce (spécification §3.1) : on refuse AVANT de toucher à l'état
    // local. Sans ce contrôle, le poste vidait l'écran de service puis le
    // restaurait sur le 409 — l'agent voyait clignoter son ticket pour rien.
    if (!canMarkAbsent(ticket)) {
      const restant = graceSecondsLeft(ticket);
      notify(
        "warning",
        "Patientez avant de déclarer absent",
        restant > 0
          ? `Le client vient d'être appelé : le bouton s'ouvre dans ${restant} s.`
          : "Le client vient d'être appelé : attendez la fin du délai de grâce."
      );
      return;
    }

    const previousStartedAt = get().processingStartedAt;
    const absentTicket: Ticket = {
      ...ticket,
      status: "ABSENT",
      closed_at: nowIso(),
    };
    set((state) => ({
      isLoading: true,
      error: null,
      currentTicket: null,
      processingStartedAt: null,
      heldTickets: [
        absentTicket,
        ...state.heldTickets.filter((t) => t.id !== absentTicket.id),
      ].slice(0, 10),
    }));
    void playAlertSound();

    const closeInCache = async (): Promise<void> => {
      await db.upsertTicket(absentTicket);
      await useOfflineStore.getState().enqueue("MARK_ABSENT", {
        ticket_id: ticketId,
        counter_id: counterId,
      });
    };

    try {
      if (useOfflineStore.getState().isOnline) {
        try {
          const result = await apiService.markTicketAbsent(ticketId, counterId);
          // Le serveur est la seule autorité sur le compteur d'absences et sur
          // la fenêtre de retour : on recopie ce qu'il renvoie au lieu de le
          // déduire localement.
          const stored: Ticket = {
            ...absentTicket,
            missed_count: result.missed_count ?? absentTicket.missed_count,
            recovery_expires_at:
              result.recovery_expires_at ?? absentTicket.recovery_expires_at,
          };
          await db.upsertTicket(stored);
          set((state) => ({
            heldTickets: state.heldTickets.map((t) => (t.id === stored.id ? stored : t)),
          }));
          refreshQueues();
          notify(
            "info",
            `Ticket ${ticket.number} marqué absent`,
            result.recovery_allowed === false
              ? "Le client a atteint le nombre d'absences autorisé : la reprise ne sera plus possible."
              : undefined
          );
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
      set((state) => ({
        currentTicket: ticket,
        processingStartedAt: previousStartedAt,
        heldTickets: state.heldTickets.filter((t) => t.id !== absentTicket.id),
      }));
      // Un refus du moteur (grâce, plafond) n'est pas une panne : c'est une
      // règle. Il s'affiche en avertissement, avec le délai ou le compteur que
      // le serveur a fourni, et non en « erreur » générique.
      const notice = absenceErrorMessage(err);
      notify(
        notice ? "warning" : "error",
        notice?.title ?? "Impossible de marquer absent",
        notice?.message ?? errorMessage(err)
      );
    } finally {
      set({ isLoading: false });
    }
  },

  markIncomplete: async (ticketId, counterId, reason) => {
    const ticket = get().currentTicket;
    if (!ticket || get().isLoading) {
      if (!ticket) notify("warning", "Aucun ticket en cours");
      return;
    }
    if (!canTransition(ticket.status, "INCOMPLETE")) {
      notify(
        "warning",
        "Action impossible",
        `Le ticket ${ticket.number} est au statut ${ticket.status}.`
      );
      return;
    }

    const previousStartedAt = get().processingStartedAt;
    const incompleteTicket: Ticket = {
      ...ticket,
      status: "INCOMPLETE",
    };

    set((state) => ({
      isLoading: true,
      error: null,
      currentTicket: null,
      processingStartedAt: null,
      heldTickets: [
        incompleteTicket,
        ...state.heldTickets.filter((t) => t.id !== incompleteTicket.id),
      ].slice(0, 10),
    }));

    const saveInOutbox = async (): Promise<void> => {
      await db.upsertTicket(incompleteTicket);
      await useOfflineStore.getState().enqueue("MARK_INCOMPLETE", {
        ticket_id: ticketId,
        counter_id: counterId,
        reason,
      });
    };

    try {
      if (useOfflineStore.getState().isOnline) {
        try {
          await apiService.markTicketIncomplete(ticketId, counterId, reason);
          await db.upsertTicket(incompleteTicket);
          refreshQueues();
          notify("info", `Ticket ${ticket.number} mis en suspens (incomplet)`);
          return;
        } catch (err) {
          if (isNetworkFailure(err)) {
            useOfflineStore.getState().setOnline(false);
          } else if (!isTimeoutFailure(err)) {
            throw err;
          }
        }
      }

      await saveInOutbox();
      notify(
        "warning",
        "Dossier incomplet enregistré",
        "Synchronisation automatique en attente."
      );
    } catch (err) {
      set((state) => ({
        currentTicket: ticket,
        processingStartedAt: previousStartedAt,
        heldTickets: state.heldTickets.filter(
          (t) => t.id !== incompleteTicket.id
        ),
      }));
      notify("error", "Interruption impossible", errorMessage(err));
    } finally {
      set({ isLoading: false });
    }
  },

  returnToQueue: async (ticket) => {
    if (get().isLoading) return false;
    set({ isLoading: true });
    try {
      let degrade = false;
      if (ticket.status === "INCOMPLETE") {
        await apiService.requeueTicket(ticket.id);
      } else {
        // `return` peut refuser pour trois raisons métier (fenêtre écoulée,
        // plafond d'absences, autre ticket actif). Aucune n'est une panne :
        // on les traite plus bas comme des règles, avec leur message.
        const result = await apiService.returnTicketToQueue(ticket.id);
        degrade = result.queue_degraded === true;
      }
      const updated: Ticket = {
        ...ticket,
        status: "WAITING",
        called_at: undefined,
        served_at: undefined,
        closed_at: undefined,
        // La fenêtre de reprise et la grâce n'ont plus de sens une fois le
        // ticket revenu en file : le serveur les efface, on fait de même pour
        // que l'écran ne montre pas une échéance périmée.
        recovery_expires_at: undefined,
        grace_expires_at: undefined,
      };
      await db.upsertTicket(updated);
      set((state) => ({
        heldTickets: state.heldTickets.filter((t) => t.id !== ticket.id),
      }));
      refreshQueues();
      notify(
        degrade ? "warning" : "success",
        `Ticket ${ticket.number} remis en file`,
        degrade
          ? "Position indisponible pour l'instant : la file sera rétablie automatiquement."
          : undefined
      );
      return true;
    } catch (err) {
      const notice = absenceErrorMessage(err);
      notify(
        notice ? "warning" : "error",
        notice?.title ?? "Remise en file impossible",
        notice?.message ?? errorMessage(err)
      );
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  closeHeldTicket: async (ticketId, reason) => {
    if (get().isLoading) return false;
    const target = get().heldTickets.find((t) => t.id === ticketId);
    set({ isLoading: true });
    try {
      await apiService.closeTicket(ticketId, reason);
      if (target) {
        await db.upsertTicket({
          ...target,
          status: "CANCELLED",
          closed_at: nowIso(),
        });
      }
      set((state) => ({
        heldTickets: state.heldTickets.filter((t) => t.id !== ticketId),
      }));
      refreshQueues();
      notify(
        "info",
        target
          ? `Ticket ${target.number} clôturé`
          : "Ticket clôturé"
      );
      return true;
    } catch (err) {
      notify("error", "Clôture impossible", errorMessage(err));
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  decidePriority: async (ticketId, approve, priority) => {
    if (get().isLoading) return null;
    set({ isLoading: true });
    try {
      await apiService.decideTicketPriority(ticketId, { approve, priority });
      const refreshed = await apiService.getTicket(ticketId);
      await db.upsertTicket(refreshed);
      refreshQueues();
      notify(
        "success",
        approve ? "Priorité confirmée" : "Demande de priorité refusée",
        `Ticket ${refreshed.number}`
      );
      return refreshed;
    } catch (err) {
      notify("error", "Décision de priorité impossible", errorMessage(err));
      return null;
    } finally {
      set({ isLoading: false });
    }
  },

  loadHeldTickets: async (branchId) => {
    if (!branchId) return;
    try {
      const [absentTickets, incompleteTickets] = await Promise.all([
        db.getTicketsByStatus(branchId, "ABSENT"),
        db.getTicketsByStatus(branchId, "INCOMPLETE"),
      ]);
      const cached = [...incompleteTickets, ...absentTickets];
      const cutoffMs = Date.now() - 12 * 3600 * 1000;
      const held = cached.filter((t) => {
        const createdMs = Date.parse(t.created_at);
        return Number.isNaN(createdMs) || createdMs >= cutoffMs;
      });
      set({ heldTickets: held.slice(0, 10) });
    } catch {
      // Cache SQLite indisponible
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
          } else if (isTimeoutFailure(err)) {
            // Réponse perdue : le transfert a peut-être été appliqué. On
            // n'enfile pas (le rejeu échouerait) et on rend le ticket au
            // guichet en signalant l'incertitude.
            set({
              currentTicket: ticket,
              processingStartedAt: previousStartedAt,
            });
            refreshQueues();
            notify(
              "warning",
              "Transfert incertain",
              "Le serveur n'a pas répondu. Vérifiez la file avant de réessayer."
            );
            return false;
          } else {
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
      processingStartedAt: ticket
        ? ticket.served_at ?? ticket.called_at ?? nowIso()
        : null,
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
        processingStartedAt:
          ticket.served_at ?? ticket.called_at ?? nowIso(),
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
      heldTickets: [],
      lastRecall: null,
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

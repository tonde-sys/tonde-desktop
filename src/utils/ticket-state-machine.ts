// ============================================================
// TONDE DESKTOP — Machine à états tickets (vue guichetier)
// Toute transition non listée ici est INTERDITE
// ============================================================

import type { TicketStatus } from "../types";

// Transitions autorisées : from → [to, ...]
// Alignées sur ALLOWED_TRANSITIONS du backend : le guichet clôture
// directement un ticket CALLED (le backend traverse CALLED → SERVING →
// DONE en une seule action), mais un ticket en service (SERVING) ne peut
// pas devenir ABSENT ni être annulé par le guichet.
const TRANSITIONS: Partial<Record<TicketStatus, TicketStatus[]>> = {
  WAITING: ["CALLED", "CANCELLED"],
  CALLED: ["PROCESSING", "COMPLETED", "ABSENT"],
  PROCESSING: ["COMPLETED", "INCOMPLETE"],
  INCOMPLETE: ["WAITING", "CANCELLED"],
  ABSENT: ["WAITING", "CANCELLED"],
};

// Actions disponibles par état
type TicketAction =
  | "call"
  | "startService"
  | "markAbsent"
  | "markIncomplete"
  | "complete"
  | "transfer"
  | "requeue"
  | "close";

const AVAILABLE_ACTIONS: Partial<Record<TicketStatus, TicketAction[]>> = {
  WAITING: ["call", "close"],
  CALLED: ["startService", "complete", "markAbsent", "transfer"],
  PROCESSING: ["complete", "markIncomplete", "transfer"],
  INCOMPLETE: ["requeue", "close"],
  ABSENT: ["requeue", "close"],
};

/**
 * Vérifie si une transition est autorisée
 */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Retourne les actions disponibles pour un statut donné
 */
export function getAvailableActions(status: TicketStatus): TicketAction[] {
  return AVAILABLE_ACTIONS[status] ?? [];
}

/**
 * Vérifie si une action est disponible pour un statut donné
 */
export function canPerformAction(status: TicketStatus, action: TicketAction): boolean {
  return getAvailableActions(status).includes(action);
}

/**
 * Lance une erreur si la transition est invalide
 */
export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `[StateMachine] Transition interdite : ${from} → ${to}`
    );
  }
}

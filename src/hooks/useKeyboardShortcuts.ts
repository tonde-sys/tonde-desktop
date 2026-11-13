// ============================================================
// TONDE DESKTOP — useKeyboardShortcuts
// Gestion globale des raccourcis clavier (Keyboard First)
// Matrice : Espace/F1 Appeler · A/F2 Absent · T/F3 Transférer
//           P/F4 Pause · R Rappeler · F12 Aide · Ctrl+L Déconnexion
// ============================================================

import { useEffect, useCallback, useRef } from "react";
import { useTicketStore } from "../store/ticketStore";
import { useCounterStore } from "../store/counterStore";
import { useAuthStore } from "../store/authStore";
import { useAppStore } from "../store/app.store";

export interface ShortcutHandlers {
  onCallNext?: () => void;
  onRecall?: () => void;
  onMarkAbsent?: () => void;
  onTransfer?: () => void;
  onPause?: () => void;
  onHelp?: () => void;
  onEscape?: () => void;
  onLogout?: () => void;
}

// Tags qui bloquent les raccourcis (l'agent saisit du texte)
const BLOCK_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;

    if (BLOCK_TAGS.has(target.tagName)) return;
    if (target.isContentEditable) return;

    const { key } = e;

    // Ctrl+L / Cmd+L — déconnexion
    if ((e.ctrlKey || e.metaKey) && (key === "l" || key === "L")) {
      e.preventDefault();
      handlersRef.current.onLogout?.();
      return;
    }

    // Les autres combinaisons avec modificateur sont laissées au système
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Un appui maintenu ne doit jamais déclencher plusieurs actions
    if (e.repeat) return;

    // Un dialogue ouvert capture les actions métier : seuls Échap et
    // l'aide restent actifs. Le modal de transfert gère ses flèches.
    const { isShortcutsHelpOpen, isTransferModalOpen } =
      useAppStore.getState();
    if (isShortcutsHelpOpen || isTransferModalOpen) {
      if (key === "Escape") {
        handlersRef.current.onEscape?.();
      } else if (key === "F12") {
        e.preventDefault();
        handlersRef.current.onHelp?.();
      }
      return;
    }

    switch (key) {
      case " ": // ESPACE — Appeler suivant
      case "F1":
        e.preventDefault();
        handlersRef.current.onCallNext?.();
        break;

      case "r":
      case "R": // R — Rappeler
        e.preventDefault();
        handlersRef.current.onRecall?.();
        break;

      case "a":
      case "A": // A — Absent
      case "F2":
        e.preventDefault();
        handlersRef.current.onMarkAbsent?.();
        break;

      case "t":
      case "T": // T — Transférer
      case "F3":
        e.preventDefault();
        handlersRef.current.onTransfer?.();
        break;

      case "p":
      case "P": // P — Pause
      case "F4":
        e.preventDefault();
        handlersRef.current.onPause?.();
        break;

      case "F12": // F12 — Aide
        e.preventDefault();
        handlersRef.current.onHelp?.();
        break;

      case "Escape": // ESC — Fermer dialogue
        handlersRef.current.onEscape?.();
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

// ---- Agent-specific shortcuts (connected to stores) ----

export function useAgentShortcuts(options: {
  onOpenTransfer: () => void;
  onOpenHelp: () => void;
  onCloseDialog: () => void;
}) {
  const { callNext, recall, markAbsent, currentTicket } = useTicketStore();
  const { myCounter, pauseCounter, resumeCounter } = useCounterStore();
  const { user } = useAuthStore();

  useKeyboardShortcuts({
    onCallNext: () => {
      if (!user) return;
      if (!myCounter || myCounter.status !== "OPEN") return;
      if (currentTicket) return;
      void callNext(myCounter.id, myCounter.service_ids);
    },

    onRecall: () => {
      if (!currentTicket || !myCounter) return;
      void recall(myCounter.id);
    },

    onMarkAbsent: () => {
      if (!currentTicket || !myCounter) return;
      void markAbsent(currentTicket.id, myCounter.id);
    },

    onTransfer: () => {
      if (!currentTicket) return;
      options.onOpenTransfer();
    },

    onPause: () => {
      if (!myCounter) return;
      if (myCounter.status === "OPEN") {
        void pauseCounter(myCounter.id);
      } else if (myCounter.status === "PAUSED") {
        void resumeCounter(myCounter.id);
      }
    },

    onHelp: options.onOpenHelp,
    onEscape: options.onCloseDialog,

    onLogout: () => {
      void (async () => {
        const counter = useCounterStore.getState().myCounter;
        if (counter) {
          await useCounterStore.getState().closeCounter(counter.id);
        }
        await useAuthStore.getState().logout();
      })();
    },
  });
}

// ---- Hook for tracking shortcut availability ----

export function useShortcutAvailability() {
  const { currentTicket, isLoading } = useTicketStore();
  const { myCounter } = useCounterStore();

  const canCallNext =
    !isLoading && !!myCounter && myCounter.status === "OPEN" && !currentTicket;

  const canRecall = !isLoading && !!currentTicket && !!myCounter;
  const canMarkAbsent = !isLoading && !!currentTicket && !!myCounter;
  const canTransfer = !isLoading && !!currentTicket;
  const canPause = !!myCounter && myCounter.status !== "CLOSED";

  return { canCallNext, canRecall, canMarkAbsent, canTransfer, canPause };
}

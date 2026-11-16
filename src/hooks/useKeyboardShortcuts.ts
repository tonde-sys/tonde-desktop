// ============================================================
// TONDE DESKTOP — useKeyboardShortcuts
// Gestion globale des raccourcis clavier (Keyboard First)
// Matrice : Espace/F1 Appeler · Entrée Terminer · A/F2 Absent
//           T/F3 Transférer · P/F4 Pause · F12 Aide · Ctrl+L Déconnexion
// ============================================================

import { useEffect, useCallback, useRef } from "react";
import { useTicketStore } from "../store/ticketStore";
import { useCounterStore } from "../store/counterStore";
import { useAuthStore } from "../store/authStore";
import { useAppStore } from "../store/app.store";
import { canMarkAbsent as isAbsenceAllowed } from "../utils/absence";

export interface ShortcutHandlers {
  onCallNext?: () => void;
  onRecall?: () => void;
  onComplete?: () => void;
  onMarkAbsent?: () => void;
  onMarkIncomplete?: () => void;
  onLookupTicket?: () => void;
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

    // Sur un bouton/lien déjà focalisé, Espace et Entrée gardent leur
    // comportement natif (clic) : pas de double action.
    if (
      (key === " " || key === "Enter") &&
      target.closest("button, a, [role='button']")
    ) {
      return;
    }

    // Un dialogue ouvert capture les actions métier : seuls Échap et
    // l'aide restent actifs. Le modal de transfert gère ses flèches.
    const { isShortcutsHelpOpen, isTransferModalOpen, isLookupModalOpen } =
      useAppStore.getState();
    if (isShortcutsHelpOpen || isTransferModalOpen || isLookupModalOpen) {
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

      case "Enter": // ENTRÉE — Terminer le ticket en cours
        e.preventDefault();
        handlersRef.current.onComplete?.();
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

      case "i":
      case "I": // I — Dossier incomplet
        e.preventDefault();
        handlersRef.current.onMarkIncomplete?.();
        break;

      case "f":
      case "F": // F — Rechercher / Scanner un ticket (QR · Priorité)
        e.preventDefault();
        handlersRef.current.onLookupTicket?.();
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
  onOpenLookup?: () => void;
  onOpenHelp: () => void;
  onCloseDialog: () => void;
}) {
  const {
    callNext,
    startServing,
    recall,
    complete,
    markAbsent,
    markIncomplete,
    currentTicket,
  } = useTicketStore();
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
      if (!currentTicket || currentTicket.status !== "CALLED" || !myCounter) return;
      const lastRecall = useTicketStore.getState().lastRecall;
      if (lastRecall?.ticketId === currentTicket.id && lastRecall.recallsLeft === 0) return;
      void recall(myCounter.id);
    },

    onComplete: () => {
      if (!currentTicket || !myCounter) return;
      if (currentTicket.status === "CALLED") {
        void startServing(currentTicket.id, myCounter.id);
      } else {
        void complete(currentTicket.id, myCounter.id);
      }
    },

    onMarkAbsent: () => {
      if (!currentTicket || !myCounter) return;
      // Même garde que le bouton : le clavier ne doit pas contourner la grâce.
      if (!isAbsenceAllowed(currentTicket)) return;
      void markAbsent(currentTicket.id, myCounter.id);
    },

    onMarkIncomplete: () => {
      if (!currentTicket || !myCounter) return;
      if (currentTicket.status !== "PROCESSING") return;
      void markIncomplete(currentTicket.id, myCounter.id);
    },

    onLookupTicket: () => {
      options.onOpenLookup?.();
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

  const canRecall = !isLoading && currentTicket?.status === "CALLED" && !!myCounter;
  // Le raccourci clavier applique la MÊME règle que le bouton : sans cela, la
  // touche A contournerait le délai de grâce que le bouton respecte.
  const canMarkAbsent =
    !isLoading &&
    !!currentTicket &&
    !!myCounter &&
    isAbsenceAllowed(currentTicket);
  const canTransfer = !isLoading && !!currentTicket;
  const canPause = !!myCounter && myCounter.status !== "CLOSED";

  return { canCallNext, canRecall, canMarkAbsent, canTransfer, canPause };
}

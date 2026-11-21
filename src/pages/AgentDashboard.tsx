// ============================================================
// TONDE DESKTOP — AgentDashboard
// Vue principale guichetier — layout mono-écran
// Sprint 0 : squelette avec zones définies
// ============================================================

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentLayout } from "../components/layout/AgentLayout";
import { ShortcutsHelp } from "../components/shortcuts/ShortcutsHelp";
import { TransferModal } from "../components/ticket/TransferModal";
import { TicketLookupModal } from "../components/ticket/TicketLookupModal";
import { useAppStore } from "../store/app.store";
import { useCounterStore } from "../store/counterStore";
import { useTicketStore } from "../store/ticketStore";
import { useQueueStore } from "../store/queueStore";
import { useAuthStore } from "../store/authStore";
import { useOfflineStore } from "../store/offlineStore";
import { useAgentShortcuts } from "../hooks/useKeyboardShortcuts";
import { wsManager } from "../lib/WebSocketManager";
import { preloadSounds } from "../utils/sound";
import { graceSecondsLeft } from "../utils/absence";
import { formatDuration, formatTicketNumber } from "../utils/formatters";
import {
  Phone,
  UserX,
  ArrowRightLeft,
  CheckSquare,
  RotateCcw,
  Loader2,
  Inbox,
  Play,
  Clock,
  FileWarning,
  X,
  ShieldCheck,
} from "lucide-react";

export function AgentDashboard() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const myCounter = useCounterStore((s) => s.myCounter);
  const pauseCounter = useCounterStore((s) => s.pauseCounter);
  const resumeCounter = useCounterStore((s) => s.resumeCounter);
  const {
    currentTicket,
    processingStartedAt,
    heldTickets,
    lastRecall,
    isLoading,
    callNext,
    startServing,
    markAbsent,
    markIncomplete,
    returnToQueue,
    closeHeldTicket,
    loadHeldTickets,
    recall,
    complete,
  } = useTicketStore();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const { queues, services, loadQueues } = useQueueStore();
  const {
    openTransferModal,
    openLookupModal,
    openShortcutsHelp,
    closeAllDialogs,
  } = useAppStore();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const timerAnchor =
    processingStartedAt ??
    currentTicket?.served_at ??
    currentTicket?.called_at;

  // Horloge temps réel tant qu'un ticket est actif
  useEffect(() => {
    if (!currentTicket || !timerAnchor) return;
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [currentTicket, timerAnchor]);

  const elapsedSeconds = (() => {
    if (!currentTicket || !timerAnchor) return 0;
    const startMs = Date.parse(timerAnchor);
    if (Number.isNaN(startMs)) return 0;
    return Math.max(0, Math.floor((nowMs - startMs) / 1000));
  })();

  // Décompte du délai de grâce : il s'appuie sur l'horloge `nowMs` déjà
  // rafraîchie chaque seconde, donc aucun minuteur supplémentaire.
  const graceLeft = currentTicket ? graceSecondsLeft(currentTicket, nowMs) : 0;

  // Préchargement sons au montage
  useEffect(() => {
    preloadSounds();
  }, []);

  // Rafraîchit l'état réel du guichet au démarrage, puis reprend le
  // ticket éventuellement en cours (redémarrage, changement de poste).
  useEffect(() => {
    const counterId = useCounterStore.getState().myCounter?.id;
    if (!counterId) return;
    void useCounterStore
      .getState()
      .loadMyCounter(counterId)
      .then(() => {
        const counter = useCounterStore.getState().myCounter;
        if (counter?.current_ticket_id) {
          void useTicketStore
            .getState()
            .restoreCurrentTicket(counter.current_ticket_id);
        }
      });
    // Au montage uniquement : myCounter est ensuite piloté par le store.
  }, []);

  // Chargement initial de la file et des tickets en suspens
  useEffect(() => {
    if (user?.branch_id) {
      loadQueues(user.branch_id);
      void loadHeldTickets(user.branch_id);
    }
  }, [user?.branch_id, loadQueues, loadHeldTickets]);

  // Connexion WebSocket du guichet
  useEffect(() => {
    if (user?.token && myCounter?.id && user.branch_id) {
      wsManager.connect(myCounter.id, user.token, user.branch_id);
    }
    return () => wsManager.disconnect();
  }, [user?.token, user?.branch_id, myCounter?.id]);

  // Raccourcis clavier
  useAgentShortcuts({
    onOpenTransfer: openTransferModal,
    onOpenLookup: openLookupModal,
    onOpenHelp: openShortcutsHelp,
    onCloseDialog: closeAllDialogs,
  });

  const serviceIds = myCounter?.service_ids ?? [];
  // Backend réel : aucun service n'est rattaché au guichet, toutes les
  // files de l'agence sont donc candidates à l'appel.
  const relevantQueues =
    serviceIds.length > 0
      ? queues.filter((q) => serviceIds.includes(q.service_id))
      : queues;
  const totalWaiting = relevantQueues.reduce(
    (sum, q) => sum + q.waiting_count,
    0
  );

  const handleCallNext = () => {
    if (!myCounter || myCounter.status !== "OPEN" || currentTicket) return;
    void callNext(myCounter.id, serviceIds);
  };

  const handleStartServing = () => {
    if (!currentTicket || !myCounter) return;
    void startServing(currentTicket.id, myCounter.id);
  };

  const handleMarkAbsent = () => {
    if (!currentTicket || !myCounter) return;
    void markAbsent(currentTicket.id, myCounter.id);
  };

  const handleMarkIncomplete = () => {
    if (!currentTicket || !myCounter) return;
    void markIncomplete(currentTicket.id, myCounter.id);
  };

  const handleRecall = () => {
    if (!myCounter) return;
    void recall(myCounter.id);
  };

  const handleComplete = () => {
    if (!currentTicket || !myCounter) return;
    void complete(currentTicket.id, myCounter.id);
  };

  const currentServiceName = currentTicket
    ? (queues.find((q) => q.service_id === currentTicket.service_id)
        ?.service_name ??
      services.find((s) => s.id === currentTicket.service_id)?.name ??
      null)
    : null;

  const handlePauseToggle = () => {
    if (!myCounter) return;
    if (myCounter.status === "PAUSED") {
      void resumeCounter(myCounter.id);
    } else {
      void pauseCounter(myCounter.id);
    }
  };

  return (
    <AgentLayout onPause={handlePauseToggle}>
      <div className="h-full grid grid-cols-[1fr_320px] gap-0">
        {/* ── Zone principale : ticket en cours ── */}
        <div className="flex flex-col items-center justify-center gap-8 px-8 border-r border-border-subtle">
          {myCounter?.status === "PAUSED" && (
            <div className="w-full max-w-xl rounded-card border border-amber/40 bg-amber/10 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-amber font-medium text-sm">
                  {t("counter.status.paused")}
                </p>
                <p className="text-text-secondary text-xs mt-0.5">
                  {t("counter.pausedHint")}
                </p>
              </div>
              <button
                onClick={handlePauseToggle}
                className="btn-primary flex items-center gap-2"
              >
                <Play size={16} />
                {t("counter.resume")}
                <span className="kbd kbd-inverse">P</span>
              </button>
            </div>
          )}

          {currentTicket ? (
            <>
              {/* Numéro ticket géant + service + priorité + chronomètre */}
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <p className="text-text-muted text-sm uppercase tracking-widest">
                    {t("ticket.currentTicket")}
                  </p>
                  {currentTicket.priority > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber/15 text-amber border border-amber/40">
                      {t("ticket.priority")}
                    </span>
                  )}
                </div>
                <p
                  className="font-mono font-bold text-cyan leading-none"
                  style={{ fontSize: "120px" }}
                >
                  {formatTicketNumber(currentTicket.number)}
                </p>
                {currentServiceName && (
                  <p className="text-text-primary font-medium text-base mt-3">
                    {currentServiceName}
                  </p>
                )}
                {/* Identité du client — anti-fraude : le guichetier vérifie
                    que la personne présente correspond à celle qui a pris le
                    ticket. */}
                {(currentTicket.client_name || currentTicket.client_phone) && (
                  <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-btn bg-cyan/10 border border-cyan/30">
                    <ShieldCheck size={14} className="text-cyan" />
                    <span className="text-sm text-text-primary font-medium">
                      {currentTicket.client_name ?? "Client"}
                    </span>
                    {currentTicket.client_phone && (
                      <span className="text-xs text-text-secondary font-mono">
                        {currentTicket.client_phone}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-center gap-2 text-text-secondary text-sm mt-2">
                  <span>
                    {t(`ticket.status.${currentTicket.status.toLowerCase()}`)}
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 font-mono text-xs text-text-muted">
                    <Clock size={12} />
                    {formatDuration(elapsedSeconds)}
                  </span>
                </div>
              </div>

              {/* Actions sur le ticket en cours */}
              <div className="flex flex-wrap gap-3 justify-center">
                {currentTicket.status === "CALLED" ? (
                  <button
                    onClick={handleStartServing}
                    disabled={isLoading}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Play size={16} />
                    {t("ticket.startServing")}
                    <span className="kbd kbd-inverse">{t("common.enter")}</span>
                  </button>
                ) : (
                  <button
                    onClick={handleComplete}
                    disabled={isLoading}
                    className="btn-primary flex items-center gap-2"
                  >
                    <CheckSquare size={16} />
                    {t("ticket.complete")}
                    <span className="kbd kbd-inverse">{t("common.enter")}</span>
                  </button>
                )}
                {currentTicket.status === "CALLED" && (
                  <button
                    onClick={handleMarkAbsent}
                    // Le bouton s'ouvre à la fin du délai de grâce (spécification
                    // §3.1) : un agent ne peut pas déclarer absent un client
                    // qu'il vient d'appeler. Le décompte est affiché pour qu'il
                    // sache QUAND il pourra agir, au lieu de cliquer et de lire
                    // un refus.
                    disabled={isLoading || graceLeft > 0}
                    title={
                      graceLeft > 0
                        ? t("ticket.absentGrace", { seconds: graceLeft })
                        : undefined
                    }
                    className="btn-danger flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <UserX size={16} />
                    {graceLeft > 0
                      ? t("ticket.absentIn", { seconds: graceLeft })
                      : t("ticket.markAbsent")}
                    <span className="kbd kbd-inverse">A</span>
                  </button>
                )}
                {currentTicket.status === "PROCESSING" && (
                  <button
                    onClick={handleMarkIncomplete}
                    disabled={isLoading}
                    className="btn-ghost border border-amber/40 text-amber hover:bg-amber/10 flex items-center gap-2"
                  >
                    <FileWarning size={16} />
                    {t("ticket.markIncomplete")}
                    <span className="kbd">I</span>
                  </button>
                )}
                <button
                  onClick={() => openTransferModal()}
                  disabled={isLoading}
                  className="btn-ghost border border-border-subtle flex items-center gap-2"
                >
                  <ArrowRightLeft size={16} />
                  {t("ticket.transfer")}
                  <span className="kbd">T</span>
                </button>
                {currentTicket.status === "CALLED" && (
                  <button
                    onClick={handleRecall}
                    disabled={
                      isLoading ||
                      !isOnline ||
                      (lastRecall?.ticketId === currentTicket.id && lastRecall.recallsLeft === 0)
                    }
                    className="btn-ghost flex items-center gap-2"
                    title={lastRecall?.ticketId === currentTicket.id
                      ? t("ticket.recallsLeft", { count: lastRecall.recallsLeft })
                      : undefined}
                  >
                    <RotateCcw size={14} />
                    {t("ticket.recall")}
                    {lastRecall?.ticketId === currentTicket.id && (
                      <span className="text-xs text-text-secondary">
                        {t("ticket.recallsLeft", { count: lastRecall.recallsLeft })}
                      </span>
                    )}
                    <span className="kbd">R</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Aucun ticket — bouton Appeler */}
              <div className="text-center">
                <Inbox size={48} className="text-text-muted mx-auto mb-4" />
                <p className="text-text-muted text-base">
                  {totalWaiting > 0
                    ? t("queue.waiting", { count: totalWaiting })
                    : t("ticket.noTicket")}
                </p>
              </div>

              <button
                onClick={handleCallNext}
                disabled={
                  isLoading ||
                  !myCounter ||
                  myCounter.status !== "OPEN" ||
                  !isOnline
                }
                className="btn-primary text-xl px-12 py-5 flex items-center gap-3
                  shadow-[0_0_30px_rgba(108,71,255,0.3)] hover:shadow-[0_0_40px_rgba(108,71,255,0.5)]"
              >
                {isLoading ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Phone size={20} />
                )}
                {t("ticket.callNext")}
                <span className="kbd kbd-inverse">Espace</span>
              </button>
              {!isOnline && (
                <p className="text-amber text-xs">{t("ticket.callOffline")}</p>
              )}
            </>
          )}
        </div>

        {/* ── Zone droite : file d'attente ── */}
        <div className="flex flex-col bg-obsidian overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <p className="text-text-secondary text-sm font-medium">
              {t("queue.title")}
            </p>
            <p className="text-cyan font-mono font-bold text-2xl mt-0.5">
              {totalWaiting}
            </p>
          </div>

          {/* Liste des files — tickets nominatifs en mode mock,
              synthèse par service avec le backend réel */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {relevantQueues.map((queue) => {
              const waitingTickets = queue.tickets.filter(
                (t) => t.status === "WAITING"
              );

              if (waitingTickets.length === 0) {
                return (
                  <div
                    key={queue.service_id}
                    className="card-secondary flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-text-primary text-sm font-medium truncate">
                        {queue.service_name}
                      </span>
                      {queue.ticket_prefix && (
                        <span className="text-text-muted text-xs font-mono">
                          {queue.ticket_prefix}
                        </span>
                      )}
                    </div>
                    <span className="font-mono font-semibold text-cyan text-sm">
                      {queue.waiting_count}
                    </span>
                  </div>
                );
              }

              return waitingTickets.slice(0, 15).map((ticket, i) => (
                <div
                  key={ticket.id}
                  className="card-secondary flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-text-muted text-xs font-mono w-4">
                      {i + 1}
                    </span>
                    <span className="font-mono font-semibold text-cyan text-sm">
                      {formatTicketNumber(ticket.number)}
                    </span>
                  </div>
                  {ticket.priority > 0 && (
                    <span className="text-amber text-xs font-medium">
                      {t("ticket.priority")}
                    </span>
                  )}
                </div>
              ));
            })}

            {totalWaiting === 0 && (
              <div className="flex items-center justify-center h-full">
                <p className="text-text-muted text-sm">{t("queue.empty")}</p>
              </div>
            )}
          </div>

          {/* Section bas du panneau droit : tickets en suspens (Absents / Incomplets) */}
          {heldTickets.length > 0 && (
            <div className="border-t border-border-subtle p-3 bg-ink/60">
              <div className="flex items-center justify-between mb-2">
                <p className="text-text-secondary text-xs font-medium uppercase tracking-wider">
                  {t("ticket.heldTickets")}
                </p>
                <span className="text-xs font-mono text-amber">
                  {heldTickets.length}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                {heldTickets.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-btn bg-obsidian border border-border-subtle"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-semibold text-xs text-text-primary">
                        {formatTicketNumber(item.number)}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                          item.status === "INCOMPLETE"
                            ? "bg-amber/15 text-amber border-amber/40"
                            : "bg-rose/15 text-rose border-rose/30"
                        }`}
                      >
                        {t(`ticket.status.${item.status.toLowerCase()}`)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => void returnToQueue(item)}
                        className="btn-ghost text-[11px] py-1 px-2 border border-border-subtle flex items-center gap-1"
                        title={t("ticket.requeue")}
                      >
                        <RotateCcw size={11} />
                        <span>{t("ticket.requeueShort")}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => void closeHeldTicket(item.id)}
                        className="btn-ghost p-1 text-rose/70 hover:text-rose"
                        title={t("ticket.closeTicket")}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Overlay aide raccourcis */}
      <ShortcutsHelp />
      {/* Modale de transfert */}
      <TransferModal />
      {/* Modale de recherche / scan QR / priorité */}
      <TicketLookupModal />
    </AgentLayout>
  );
}

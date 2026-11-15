// ============================================================
// TONDE DESKTOP — TicketLookupModal
// Recherche / Scan QR de ticket : validation de priorité,
// remise en file (absent / incomplet) et clôture
// ============================================================

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store/app.store";
import { useTicketStore } from "../../store/ticketStore";
import { useQueueStore } from "../../store/queueStore";
import { apiService } from "../../services/api/apiService";
import { formatTicketNumber } from "../../utils/formatters";
import type { Ticket } from "../../types";
import {
  QrCode,
  Search,
  X,
  Check,
  XCircle,
  RotateCcw,
  ShieldAlert,
  Loader2,
} from "lucide-react";

export function TicketLookupModal() {
  const { t } = useTranslation();
  const { isLookupModalOpen, closeLookupModal } = useAppStore();
  const {
    heldTickets,
    isLoading,
    returnToQueue,
    closeHeldTicket,
    decidePriority,
  } = useTicketStore();
  const { queues, services } = useQueueStore();

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isLookupModalOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [isLookupModalOpen]);

  const handleClose = () => {
    setQuery("");
    setTicket(null);
    setError(null);
    closeLookupModal();
  };

  if (!isLookupModalOpen) return null;

  const resolveServiceName = (serviceId: string): string =>
    queues.find((q) => q.service_id === serviceId)?.service_name ??
    services.find((s) => s.id === serviceId)?.name ??
    "—";

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    try {
      const found = await apiService.lookupTicket(trimmed);
      setTicket(found);
    } catch (err) {
      setTicket(null);
      setError(
        err instanceof Error ? err.message : t("ticket.lookupNotFound")
      );
    } finally {
      setSearching(false);
    }
  };

  const handleDecidePriority = async (
    approve: boolean,
    priorityLevel?: "priority" | "vip" | "emergency"
  ) => {
    if (!ticket) return;
    const updated = await decidePriority(ticket.id, approve, priorityLevel);
    if (updated) {
      setTicket(updated);
    }
  };

  const handleReturnToQueue = async (target: Ticket) => {
    const ok = await returnToQueue(target);
    if (ok && ticket?.id === target.id) {
      setTicket({ ...target, status: "WAITING" });
    }
  };

  const handleCloseTicket = async (target: Ticket) => {
    const ok = await closeHeldTicket(target.id);
    if (ok && ticket?.id === target.id) {
      setTicket({ ...target, status: "CANCELLED" });
    }
  };

  const priorityLabel = (prio?: Ticket["priority"]) => {
    if (prio === 2) return "VIP / Urgence";
    if (prio === 1) return t("ticket.priority");
    return "Standard";
  };

  return (
    <div
      className="fixed inset-0 bg-midnight/80 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("ticket.lookupTitle")}
        className="card w-full max-w-lg mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-text-primary font-semibold">
            <QrCode size={18} className="text-violet" />
            <span>{t("ticket.lookupTitle")}</span>
          </div>
          <button
            onClick={handleClose}
            className="btn-ghost p-1"
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </div>

        {/* Barre de recherche QR / ID */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("ticket.lookupPlaceholder")}
            className="flex-1 bg-obsidian border border-border-subtle rounded-btn px-3.5 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-violet"
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="btn-primary px-4 py-2 text-sm flex items-center gap-1.5"
          >
            {searching ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Search size={15} />
            )}
            <span>{t("ticket.search")}</span>
          </button>
        </form>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-btn bg-rose/10 border border-rose/30 text-rose text-xs">
            {error}
          </div>
        )}

        {/* Résultat du ticket recherché */}
        {ticket && (
          <div className="p-4 rounded-btn bg-obsidian border border-border-subtle mb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-2xl text-cyan">
                    {formatTicketNumber(ticket.number)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-ink text-text-secondary border border-border-subtle">
                    {t(`ticket.status.${ticket.status.toLowerCase()}`)}
                  </span>
                  {ticket.priority > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber/15 text-amber border border-amber/40">
                      {priorityLabel(ticket.priority)}
                    </span>
                  )}
                </div>
                <p className="text-text-secondary text-xs mt-1">
                  {resolveServiceName(ticket.service_id)}
                </p>
              </div>
            </div>

            {/* Demande de priorité en attente de validation */}
            {ticket.status === "WAITING" &&
              ticket.requested_priority !== undefined &&
              ticket.requested_priority > 0 && (
                <div className="mt-3 p-3 rounded-btn bg-amber/10 border border-amber/30 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-amber text-xs">
                    <ShieldAlert size={15} />
                    <span>
                      {t("ticket.requestedPriority")} :{" "}
                      <strong>{priorityLabel(ticket.requested_priority)}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => void handleDecidePriority(true)}
                      className="px-2.5 py-1 rounded text-xs font-medium bg-emerald/20 text-emerald border border-emerald/40 hover:bg-emerald/30 flex items-center gap-1"
                    >
                      <Check size={12} />
                      {t("ticket.approvePriority")}
                    </button>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => void handleDecidePriority(false)}
                      className="px-2.5 py-1 rounded text-xs font-medium bg-rose/15 text-rose border border-rose/30 hover:bg-rose/25 flex items-center gap-1"
                    >
                      <XCircle size={12} />
                      {t("ticket.rejectPriority")}
                    </button>
                  </div>
                </div>
              )}

            {/* Attribution directe de priorité sur un ticket WAITING */}
            {ticket.status === "WAITING" && (
              <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between gap-2 flex-wrap">
                <span className="text-text-muted text-xs">
                  {t("ticket.assignPriority")}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void handleDecidePriority(true, "priority")}
                    className="btn-ghost text-xs py-1 px-2.5 border border-border-subtle"
                  >
                    {t("ticket.priority")}
                  </button>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void handleDecidePriority(true, "vip")}
                    className="btn-ghost text-xs py-1 px-2.5 border border-border-subtle"
                  >
                    VIP
                  </button>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void handleDecidePriority(true, "emergency")}
                    className="btn-ghost text-xs py-1 px-2.5 border border-amber/40 text-amber"
                  >
                    {t("ticket.emergency")}
                  </button>
                </div>
              </div>
            )}

            {/* Actions remise en file / clôture */}
            {(ticket.status === "ABSENT" ||
              ticket.status === "INCOMPLETE" ||
              ticket.status === "WAITING") && (
              <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-end gap-2">
                {(ticket.status === "ABSENT" ||
                  ticket.status === "INCOMPLETE") && (
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void handleReturnToQueue(ticket)}
                    className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
                  >
                    <RotateCcw size={13} />
                    {t("ticket.requeue")}
                  </button>
                )}
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleCloseTicket(ticket)}
                  className="btn-danger text-xs py-1.5 px-3 flex items-center gap-1.5"
                >
                  <XCircle size={13} />
                  {t("ticket.closeTicket")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Liste rapide des tickets en suspens sur ce poste */}
        {heldTickets.length > 0 && (
          <div>
            <p className="text-text-secondary text-xs uppercase tracking-wider mb-2">
              {t("ticket.heldTickets")} ({heldTickets.length})
            </p>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {heldTickets.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-3 py-2 rounded-btn bg-obsidian border border-border-subtle"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-semibold text-sm text-text-primary">
                      {formatTicketNumber(item.number)}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        item.status === "INCOMPLETE"
                          ? "bg-amber/15 text-amber border-amber/40"
                          : "bg-rose/15 text-rose border-rose/30"
                      }`}
                    >
                      {t(`ticket.status.${item.status.toLowerCase()}`)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => void handleReturnToQueue(item)}
                      className="btn-ghost text-xs py-1 px-2 border border-border-subtle flex items-center gap-1"
                      title={t("ticket.requeue")}
                    >
                      <RotateCcw size={12} />
                      <span>{t("ticket.requeue")}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => void handleCloseTicket(item)}
                      className="btn-ghost text-xs py-1 px-2 text-rose/80 hover:text-rose"
                      title={t("ticket.closeTicket")}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

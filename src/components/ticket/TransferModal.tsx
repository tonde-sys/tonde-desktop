// ============================================================
// TONDE DESKTOP — TransferModal
// Modale de transfert : choix du service cible au clavier
// ↑↓ sélection · Entrée confirme · Échap ferme
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRightLeft, X } from "lucide-react";
import { useAppStore } from "../../store/app.store";
import { useTicketStore } from "../../store/ticketStore";
import { useQueueStore } from "../../store/queueStore";
import { formatTicketNumber } from "../../utils/formatters";
import type { Ticket } from "../../types";

export function TransferModal() {
  const isOpen = useAppStore((s) => s.isTransferModalOpen);
  const currentTicket = useTicketStore((s) => s.currentTicket);

  if (!isOpen || !currentTicket) return null;

  // Remonté à chaque ouverture : la sélection repart de zéro sans effet.
  return <TransferDialog ticket={currentTicket} />;
}

function TransferDialog({ ticket }: { ticket: Ticket }) {
  const { t } = useTranslation();
  const close = useAppStore((s) => s.closeTransferModal);
  const transfer = useTicketStore((s) => s.transfer);
  const isLoading = useTicketStore((s) => s.isLoading);
  const services = useQueueStore((s) => s.services);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const targets = useMemo(
    () =>
      services.filter(
        (service) => service.is_active !== false && service.id !== ticket.service_id
      ),
    [services, ticket.service_id]
  );

  const activeIndex = targets.length === 0 ? 0 : Math.min(selectedIndex, targets.length - 1);

  const confirmSelection = useCallback(
    async (serviceId: string) => {
      if (isLoading) return;
      const success = await transfer(ticket.id, "", serviceId);
      if (success) close();
    },
    [ticket.id, isLoading, transfer, close]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => {
          if (targets.length === 0) return 0;
          const delta = event.key === "ArrowDown" ? 1 : -1;
          return (index + delta + targets.length) % targets.length;
        });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const target = targets[activeIndex];
        if (target) {
          void confirmSelection(target.id);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [targets, activeIndex, confirmSelection, close]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-midnight/80 backdrop-blur-sm animate-fade-in"
      onClick={close}
    >
      <div
        className="card w-full max-w-lg mx-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t("ticket.transferTitle")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <ArrowRightLeft size={20} className="text-cyan" />
            <div>
              <h2 className="text-text-primary font-semibold text-lg">
                {t("ticket.transferTitle")}
              </h2>
              <p className="text-text-secondary text-sm mt-0.5">
                {t("ticket.transferSubtitle", {
                  number: formatTicketNumber(ticket.number),
                })}
              </p>
            </div>
          </div>
          <button
            onClick={close}
            className="text-text-muted hover:text-text-secondary transition-colors"
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
          {targets.map((service, index) => (
            <button
              key={service.id}
              onClick={() => void confirmSelection(service.id)}
              onMouseEnter={() => setSelectedIndex(index)}
              disabled={isLoading}
              className={`flex items-center justify-between rounded-btn px-4 py-3 border text-left transition-colors ${
                index === activeIndex
                  ? "border-violet bg-violet/10"
                  : "border-border-subtle bg-obsidian hover:border-violet/50"
              }`}
            >
              <span className="text-text-primary text-sm font-medium">
                {service.name}
              </span>
              <span className="text-text-muted font-mono text-xs">
                {service.code}
              </span>
            </button>
          ))}

          {targets.length === 0 && (
            <p className="text-text-muted text-sm text-center py-8">
              {t("ticket.noTransferTarget")}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between mt-5 text-xs text-text-muted">
          <span>
            ↑↓ {t("common.select")} · {t("common.enter")} {t("common.confirm")} ·{" "}
            {t("common.escape")} {t("common.cancel")}
          </span>
          <button onClick={close} className="btn-ghost text-sm">
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TONDE DESKTOP — OutboxPanel
// Actions hors ligne de l'agent courant : en attente et échecs.
// Permet de relancer ou d'abandonner une action non synchronisée.
// ============================================================

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOfflineStore, belongsToActor } from "../../store/offlineStore";
import { CloudOff, RefreshCw, RotateCcw, X, AlertTriangle } from "lucide-react";

export function OutboxPanel() {
  const { t, i18n } = useTranslation();
  const syncQueue = useOfflineStore((s) => s.syncQueue);
  const actor = useOfflineStore((s) => s.actor);
  const isSyncing = useOfflineStore((s) => s.isSyncing);
  const retryItem = useOfflineStore((s) => s.retryItem);
  const dismissItem = useOfflineStore((s) => s.dismissItem);
  const [open, setOpen] = useState(false);

  const items = useMemo(
    () =>
      syncQueue
        .filter((i) => i.status !== "DONE" && belongsToActor(i, actor))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [syncQueue, actor]
  );

  if (items.length === 0) return null;

  const failedCount = items.filter((i) => i.status === "FAILED").length;
  const pendingCount = items.length - failedCount;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t("outbox.title")}
        className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium transition-colors ${
          failedCount > 0
            ? "text-rose hover:bg-rose/10"
            : "text-amber hover:bg-amber/10"
        }`}
      >
        {isSyncing ? (
          <RefreshCw size={12} className="animate-spin" />
        ) : failedCount > 0 ? (
          <AlertTriangle size={12} />
        ) : (
          <CloudOff size={12} />
        )}
        <span>
          {failedCount > 0
            ? t("outbox.failed", { count: failedCount })
            : t("outbox.pending", { count: pendingCount })}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-white/10 bg-obsidian shadow-2xl">
          <div className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            {t("outbox.title")}
          </div>
          <ul className="max-h-64 divide-y divide-white/5 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-text-primary">
                      {t(`outbox.actions.${item.action}`, {
                        defaultValue: item.action,
                      })}
                    </p>
                    <p className="mt-0.5 text-[11px] text-text-secondary">
                      {new Date(item.created_at).toLocaleTimeString(
                        i18n.language,
                        { hour: "2-digit", minute: "2-digit" }
                      )}
                      {item.status === "FAILED" &&
                        ` · ${t("outbox.attempts", { count: item.retry_count })}`}
                    </p>
                    {item.status === "FAILED" && item.error && (
                      <p className="mt-1 break-words text-[11px] text-rose">
                        {item.error}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.status === "FAILED" && (
                      <button
                        type="button"
                        onClick={() => void retryItem(item.id)}
                        title={t("outbox.retry")}
                        aria-label={t("outbox.retry")}
                        className="rounded-md p-1 text-violet hover:bg-violet/10"
                      >
                        <RotateCcw size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void dismissItem(item.id)}
                      title={t("outbox.dismiss")}
                      aria-label={t("outbox.dismiss")}
                      className="rounded-md p-1 text-text-secondary hover:bg-white/5 hover:text-text-primary"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

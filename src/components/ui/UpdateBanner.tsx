// ============================================================
// TONDE DESKTOP — UpdateBanner
// Bandeau discret de mise à jour, posé en bas à droite.
// L'agent décide quand installer : jamais de redémarrage imposé
// pendant qu'un ticket est en cours de service.
// ============================================================

import { useTranslation } from "react-i18next";
import { ArrowDownToLine, Loader2, RefreshCw, X } from "lucide-react";
import { useAppUpdate } from "../../hooks/useAppUpdate";

export function UpdateBanner() {
  const { t } = useTranslation();
  const { status, version, progress, error, install, dismiss } = useAppUpdate();

  if (status === "idle" || status === "checking" || !version) return null;

  const installing = status === "installing";
  const failed = status === "error";

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[340px] bg-ink border border-violet/40 rounded-card p-4 shadow-2xl animate-slide-up">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-violet shrink-0">
          {installing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : failed ? (
            <RefreshCw size={16} className="text-rose" />
          ) : (
            <ArrowDownToLine size={16} />
          )}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-text-primary text-sm font-medium">
            {failed
              ? t("update.errorTitle")
              : installing
                ? t("update.installingTitle")
                : t("update.availableTitle", { version })}
          </p>

          <p className="text-text-secondary text-xs mt-1 leading-relaxed">
            {failed
              ? (error ?? t("update.errorHint"))
              : installing
                ? t("update.installingHint", { progress: progress ?? 0 })
                : t("update.availableHint")}
          </p>

          {installing && (
            <div className="mt-2 h-1 bg-midnight rounded-full overflow-hidden">
              <div
                className="h-full bg-violet transition-all duration-300"
                style={{ width: `${progress ?? 0}%` }}
              />
            </div>
          )}

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => void install()}
              disabled={installing}
              className="px-3 py-1.5 rounded-btn bg-violet text-white text-xs font-medium
                hover:bg-violet/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {failed ? t("update.retry") : t("update.install")}
            </button>
            {!installing && (
              <button
                onClick={dismiss}
                className="px-3 py-1.5 rounded-btn text-text-secondary text-xs
                  hover:text-text-primary transition-colors"
              >
                {t("update.later")}
              </button>
            )}
          </div>
        </div>

        {!installing && (
          <button
            onClick={dismiss}
            aria-label={t("update.later")}
            className="text-text-muted hover:text-text-secondary transition-colors shrink-0"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

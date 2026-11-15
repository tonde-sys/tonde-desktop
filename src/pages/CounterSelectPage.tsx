// ============================================================
// TONDE DESKTOP — CounterSelectPage
// Choix du guichet à ouvrir après login
// + configuration du poste (organisation / agence)
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../store/authStore";
import { useCounterStore } from "../store/counterStore";
import {
  getApiContext,
  hasApiContext,
} from "../services/api/apiService";
import { Monitor, Loader2, ChevronRight, Settings2, Lock } from "lucide-react";

interface CounterSelectPageProps {
  onCounterSelected: () => void;
}

export function CounterSelectPage({ onCounterSelected }: CounterSelectPageProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const applyContext = useAuthStore((s) => s.applyContext);
  const { allCounters, isLoading, loadAllCounters, openCounter } = useCounterStore();

  const [manualContextReady, setManualContextReady] = useState(false);
  const [editingContext, setEditingContext] = useState(false);
  const [orgInput, setOrgInput] = useState(() => getApiContext()?.orgId ?? "");
  const [branchInput, setBranchInput] = useState(() => getApiContext()?.branchId ?? "");
  const [setupError, setSetupError] = useState<string | null>(null);

  const contextReady = manualContextReady || hasApiContext() || Boolean(user?.branch_id);
  const branchId = user?.branch_id || getApiContext()?.branchId || "";
  const assignedCounterId = user?.counter_id;
  const restrictToAssigned =
    user?.role === "Agent" &&
    Boolean(assignedCounterId) &&
    allCounters.some((c) => c.id === assignedCounterId);

  const sortedCounters = useMemo(() => {
    if (!assignedCounterId) return allCounters;
    return [...allCounters].sort((a, b) => {
      if (a.id === assignedCounterId) return -1;
      if (b.id === assignedCounterId) return 1;
      return 0;
    });
  }, [allCounters, assignedCounterId]);

  useEffect(() => {
    if (contextReady && branchId) {
      void loadAllCounters(branchId);
    }
  }, [contextReady, branchId, loadAllCounters]);

  const handleSelect = async (counterId: string) => {
    if (!user) return;
    const opened = await openCounter(counterId, user.id);
    if (opened) {
      onCounterSelected();
    }
  };

  const openContextForm = () => {
    const context = getApiContext();
    setOrgInput(context?.orgId ?? "");
    setBranchInput(context?.branchId ?? "");
    setSetupError(null);
    setEditingContext(true);
  };

  const handleSaveContext = (e: React.FormEvent) => {
    e.preventDefault();
    const orgId = orgInput.trim();
    const newBranchId = branchInput.trim();
    if (!orgId || !newBranchId) {
      setSetupError(t("counter.setup.invalid"));
      return;
    }
    setSetupError(null);
    applyContext(orgId, newBranchId);
    setManualContextReady(true);
    setEditingContext(false);
  };

  return (
    <div className="h-screen bg-midnight flex flex-col items-center justify-center p-6">
      {/* Titre */}
      <div className="mb-8 text-center">
        <img
          src="/logo/tonde-logo.png"
          alt={t("app.name")}
          className="w-20 h-20 rounded-2xl mx-auto mb-4 shadow-[0_0_40px_rgba(108,71,255,0.3)]"
        />
        <div className="flex items-center justify-center gap-2 mb-1">
          <Monitor size={20} className="text-violet" />
          <h1 className="text-text-primary font-semibold text-xl">
            {contextReady && !editingContext
              ? t("counter.select")
              : t("counter.setup.title")}
          </h1>
        </div>
        <p className="text-text-secondary text-sm mt-1">
          {contextReady && !editingContext
            ? t("counter.hello", { name: user?.name ?? "" })
            : t("counter.setup.description")}
        </p>
      </div>

      <div className="w-full max-w-md">
        {!contextReady || editingContext ? (
          <form onSubmit={handleSaveContext} className="card flex flex-col gap-4">
            <div className="flex items-center gap-2 text-text-secondary text-sm">
              <Settings2 size={16} className="text-violet" />
              <span>{t("counter.setup.hint")}</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-text-secondary text-sm">
                {t("counter.setup.orgId")}
              </label>
              <input
                value={orgInput}
                onChange={(e) => setOrgInput(e.target.value)}
                className="bg-obsidian border border-border-subtle rounded-btn px-4 py-2.5
                  text-text-primary text-sm font-mono placeholder-text-muted
                  focus:outline-none focus:border-violet transition-colors"
                placeholder="00000000-0000-0000-0000-000000000000"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-text-secondary text-sm">
                {t("counter.setup.branchId")}
              </label>
              <input
                value={branchInput}
                onChange={(e) => setBranchInput(e.target.value)}
                className="bg-obsidian border border-border-subtle rounded-btn px-4 py-2.5
                  text-text-primary text-sm font-mono placeholder-text-muted
                  focus:outline-none focus:border-violet transition-colors"
                placeholder="00000000-0000-0000-0000-000000000000"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {setupError && (
              <p className="text-rose text-xs">{setupError}</p>
            )}

            <div className="flex gap-2 mt-1">
              <button type="submit" className="btn-primary flex-1">
                {t("counter.setup.save")}
              </button>
              {contextReady && (
                <button
                  type="button"
                  onClick={() => setEditingContext(false)}
                  className="btn-ghost border border-border-subtle"
                >
                  {t("common.cancel")}
                </button>
              )}
            </div>
          </form>
        ) : isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="text-violet animate-spin" />
          </div>
        ) : allCounters.length === 0 ? (
          <div className="card text-center text-text-secondary">
            {t("counter.none")}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sortedCounters.map((counter) => {
              const isAssigned = assignedCounterId === counter.id;
              const isLocked = restrictToAssigned && !isAssigned;

              return (
                <button
                  key={counter.id}
                  onClick={() => handleSelect(counter.id)}
                  disabled={isLoading || isLocked}
                  className={`card flex items-center justify-between transition-all duration-200 group text-left ${
                    isAssigned
                      ? "border-violet/60 bg-violet/10 hover:border-violet"
                      : "hover:border-violet/50 hover:bg-ink/80"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-text-primary font-medium">
                        {counter.name}
                      </p>
                      {isAssigned && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet/20 text-violet border border-violet/40">
                          {t("counter.assigned")}
                        </span>
                      )}
                    </div>
                    <p className="text-text-muted text-xs mt-0.5">
                      {isLocked
                        ? t("counter.notAssigned")
                        : counter.status === "OPEN"
                          ? t("counter.status.open")
                          : t("counter.status.closed")}
                      {counter.description ? ` · ${counter.description}` : ""}
                    </p>
                  </div>
                  {isLocked ? (
                    <Lock size={16} className="text-text-muted" />
                  ) : (
                    <ChevronRight
                      size={18}
                      className="text-text-muted group-hover:text-violet transition-colors"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {contextReady && !editingContext && !isLoading && (
          <button
            type="button"
            onClick={openContextForm}
            className="mt-4 flex w-full items-center justify-center gap-1.5 text-xs
              text-text-muted hover:text-violet transition-colors"
          >
            <Settings2 size={13} />
            {t("counter.setup.change")}
          </button>
        )}
      </div>
    </div>
  );
}

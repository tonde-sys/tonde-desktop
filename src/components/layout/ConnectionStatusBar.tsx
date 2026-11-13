// ============================================================
// TONDE DESKTOP — ConnectionStatusBar
// Barre d'état connexion : connecté / reconnexion / hors ligne
// Source unique : offlineStore (alimenté par WebSocket + events OS)
// ============================================================

import { useTranslation } from "react-i18next";
import { useOfflineStore } from "../../store/offlineStore";
import { WifiOff, RefreshCw } from "lucide-react";
import { OutboxPanel } from "./OutboxPanel";

export function ConnectionStatusBar() {
  const { t } = useTranslation();
  const status = useOfflineStore((s) => s.connectionStatus);
  const isOnline = useOfflineStore((s) => s.isOnline);

  if (!isOnline) {
    return (
      <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-rose/10 border-b border-rose/30 text-rose text-xs animate-fade-in">
        <div className="flex items-center gap-2">
          <WifiOff size={12} />
          <span>{t("status.offline")}</span>
        </div>
        <OutboxPanel />
      </div>
    );
  }

  if (status === "CONNECTED") {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-text-secondary px-4 py-1">
        <div className="flex items-center gap-2">
          <span className="status-dot-connected" />
          <span>{t("status.connected")}</span>
        </div>
        <OutboxPanel />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-amber/10 border-b border-amber/30 text-amber text-xs animate-fade-in">
      <div className="flex items-center gap-2">
        <RefreshCw size={12} className="animate-spin" />
        <span>{t("status.reconnecting")}</span>
      </div>
      <OutboxPanel />
    </div>
  );
}

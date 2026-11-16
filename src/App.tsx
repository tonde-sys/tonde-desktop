// ============================================================
// TONDE DESKTOP — App.tsx
// Routeur principal basé sur l'état auth
// ============================================================

import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query-client";
import "./lib/i18n"; // init i18next
import { useAuthStore } from "./store/authStore";
import { useCounterStore } from "./store/counterStore";
import { useOfflineStore } from "./store/offlineStore";
import { checkBackendHealth } from "./services/api/apiService";
import { LoginPage } from "./pages/LoginPage";
import { CounterSelectPage } from "./pages/CounterSelectPage";
import { AgentDashboard } from "./pages/AgentDashboard";
import { UpdateBanner } from "./components/ui/UpdateBanner";

function BootScreen() {
  return (
    <div className="h-screen bg-midnight flex flex-col items-center justify-center gap-6">
      <img
        src="/logo/tonde-logo.png"
        alt="TONDE"
        className="w-24 h-24 rounded-3xl shadow-[0_0_50px_rgba(108,71,255,0.35)]"
      />
      <span className="font-mono font-bold text-4xl text-violet tracking-widest">
        TONDE
      </span>
      <span className="w-5 h-5 border-2 border-violet/30 border-t-violet rounded-full animate-spin" />
    </div>
  );
}

function AppRouter() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const initialize = useAuthStore((s) => s.initialize);
  const myCounter = useCounterStore((s) => s.myCounter);
  const loadSyncQueue = useOfflineStore((s) => s.loadSyncQueue);
  const syncPending = useOfflineStore((s) => s.syncPending);
  const setOnline = useOfflineStore((s) => s.setOnline);
  const isOnline = useOfflineStore((s) => s.isOnline);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Écoute réseau système : pilote le mode hors-ligne et la reprise
  // de l'outbox dès qu'un agent se reconnecte.
  useEffect(() => {
    const handleOnline = () => {
      void setOnline(true);
      // Login interrompu par une coupure : reprise automatique.
      void useAuthStore.getState().retryPendingLogin();
    };
    const handleOffline = () => {
      void setOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setOnline]);

  // Reprise des actions offline au démarrage d'une session authentifiée
  useEffect(() => {
    if (!isInitialized || !isAuthenticated) return;
    void loadSyncQueue().then(() => {
      if (navigator.onLine) {
        void syncPending();
      }
    });
  }, [isInitialized, isAuthenticated, loadSyncQueue, syncPending]);

  // Récupération automatique : un timeout ou un serveur lent ne doit pas
  // laisser le poste hors-ligne jusqu'au prochain événement système.
  useEffect(() => {
    if (!isAuthenticated || isOnline) return;
    let cancelled = false;

    const probe = async () => {
      if (await checkBackendHealth()) {
        if (!cancelled) void setOnline(true);
      }
    };

    void probe();
    const interval = setInterval(() => void probe(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAuthenticated, isOnline, setOnline]);

  if (!isInitialized) {
    return <BootScreen />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  if (!myCounter || myCounter.status === "CLOSED") {
    return (
      <CounterSelectPage onCounterSelected={() => {}} />
    );
  }

  return <AgentDashboard />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
      <UpdateBanner />
    </QueryClientProvider>
  );
}

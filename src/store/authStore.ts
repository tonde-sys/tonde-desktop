// ============================================================
// TONDE DESKTOP — Auth Store (Zustand)
// Le JWT vit dans le coffre-fort système (tokenStorage),
// jamais dans le localStorage. Réhydratation au démarrage.
// ============================================================

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser, LoginCredentials, EmployeeRole } from "../types";
import {
  apiService,
  ApiError,
  checkBackendHealth,
  getApiContext,
  httpClient,
  setApiContext,
} from "../services/api/apiService";
import { db } from "../services/database/db";
import { tokenStorage } from "../services/secure/tokenStorage";
import { wsManager } from "../lib/WebSocketManager";
import { useCounterStore } from "./counterStore";
import { useTicketStore } from "./ticketStore";
import { useQueueStore } from "./queueStore";
import { useOfflineStore } from "./offlineStore";

interface LogoutOptions {
  /** false = pas d'appel réseau (session déjà invalide) */
  remote?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isWaking: boolean;
  isInitializing: boolean;
  isInitialized: boolean;
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: (options?: LogoutOptions) => Promise<void>;
  refreshToken: () => Promise<void>;
  applyContext: (orgId: string, branchId: string) => void;
  clearError: () => void;

  // Helpers
  hasRole: (...roles: EmployeeRole[]) => boolean;
  isAgent: () => boolean;
  isSupervisor: () => boolean;
  isAdmin: () => boolean;
}

const REFRESH_MARGIN_MS = 60_000;

function isTokenExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  if (Number.isNaN(timestamp)) return false;
  return timestamp - REFRESH_MARGIN_MS <= Date.now();
}

function friendlyLoginError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return "Email ou mot de passe incorrect.";
    }
    if (err.status === 403) {
      return err.message;
    }
    if (err.status >= 500) {
      return "Le serveur TONDE est momentanément indisponible.";
    }
    if (err.status === 0) {
      return "Serveur TONDE injoignable. Sur Render, le réveil du service peut prendre jusqu'à 30 secondes.";
    }
    return err.message;
  }
  return "Serveur TONDE injoignable. Vérifiez votre connexion.";
}

// Le service Render gratuit s'endort : le premier appel peut être coupé
// pendant le réveil. On réessaie le login plutôt que de faire recliquer.
const WAKE_RETRY_DELAYS_MS = [2_000, 5_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginWithWakeRetry(
  credentials: LoginCredentials,
  onWake: () => void
): Promise<AuthUser> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await apiService.login(credentials);
    } catch (err) {
      const networkFailure = err instanceof ApiError && err.status === 0;
      if (!networkFailure || attempt >= WAKE_RETRY_DELAYS_MS.length) {
        throw err;
      }
      onWake();
      await sleep(WAKE_RETRY_DELAYS_MS[attempt]);
    }
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isWaking: false,
      isInitializing: false,
      isInitialized: false,
      error: null,

      initialize: async () => {
        if (get().isInitialized || get().isInitializing) return;
        set({ isInitializing: true });

        // Réveille le service Render pendant que l'agent saisit ses
        // identifiants : le cold start est absorbé avant le login.
        void checkBackendHealth();

        httpClient.setRefreshHandler(async () => {
          try {
            await get().refreshToken();
            return get().user?.token ?? null;
          } catch {
            return null;
          }
        });
        httpClient.setUnauthorizedHandler(() =>
          get().logout({ remote: false })
        );

        try {
          const bundle = await tokenStorage.getBundle().catch(() => null);
          const persistedUser = get().user;

          if (bundle?.accessToken && persistedUser) {
            const context = getApiContext();
            httpClient.setToken(bundle.accessToken);
            set({
              user: {
                ...persistedUser,
                token: bundle.accessToken,
                refresh_token: bundle.refreshToken,
                branch_id: persistedUser.branch_id || context?.branchId || "",
              },
              isAuthenticated: true,
            });

            if (isTokenExpired(persistedUser.token_expires_at)) {
              try {
                await get().refreshToken();
              } catch {
                // Hors-ligne : on conserve la session locale, les
                // requêtes repasseront par le refresh au retour réseau.
              }
            }

            const hydrated = await apiService.hydrateSessionContext(
              persistedUser.role
            );
            const currentUser = get().user;
            const resolvedBranch =
              hydrated?.branchId ||
              currentUser?.branch_id ||
              getApiContext()?.branchId ||
              "";
            const resolvedCounter =
              hydrated?.counterId ?? currentUser?.counter_id;

            if (
              currentUser &&
              (resolvedBranch !== currentUser.branch_id ||
                resolvedCounter !== currentUser.counter_id)
            ) {
              set({
                user: {
                  ...currentUser,
                  branch_id: resolvedBranch,
                  counter_id: resolvedCounter,
                },
              });
            }

            useOfflineStore.getState().setActor({
              userId: persistedUser.id,
              branchId: resolvedBranch,
            });
          } else {
            if (bundle?.accessToken) {
              await tokenStorage.clear().catch(() => undefined);
            }
            httpClient.clearToken();
            set({ user: null, isAuthenticated: false });
          }
        } finally {
          set({ isInitializing: false, isInitialized: true });
        }
      },

      login: async (credentials) => {
        set({ isLoading: true, isWaking: false, error: null });
        try {
          const user = await loginWithWakeRetry(credentials, () =>
            set({ isWaking: true })
          );

          // Écriture de cache hors du chemin critique : le login réussit
          // même si le coffre ou SQLite est indisponible.
          try {
            await tokenStorage.setBundle({
              accessToken: user.token,
              refreshToken: user.refresh_token,
              expiresAt: user.token_expires_at,
            });
          } catch (err) {
            console.warn("[TONDE] Jetons non persistés sur ce poste", err);
          }
          void db.upsertEmployee({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            is_active: true,
            branch_id: user.branch_id,
            counter_id: user.counter_id,
          });

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            isWaking: false,
            error: null,
          });

          // Les actions hors ligne sont rattachées à cet agent : elles ne
          // seront jamais rejouées par un autre agent sur le même poste.
          useOfflineStore.getState().setActor({
            userId: user.id,
            branchId: user.branch_id || getApiContext()?.branchId || "",
          });
        } catch (err) {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            isWaking: false,
            error: friendlyLoginError(err),
          });
        }
      },

      logout: async (options) => {
        if (options?.remote !== false) {
          const offline = useOfflineStore.getState();
          // Dernière chance d'écouler les actions en attente avant que le
          // jeton ne soit révoqué. Un échec ne bloque jamais la déconnexion.
          if (offline.isOnline && offline.hasPending()) {
            await offline.syncPending().catch(() => undefined);
          }

          const bundle = await tokenStorage.getBundle().catch(() => null);
          try {
            await apiService.logout(bundle?.refreshToken);
          } catch {
            // Déconnexion locale garantie même si le réseau échoue
          }
        }
        httpClient.clearToken();
        await tokenStorage.clear().catch(() => undefined);

        wsManager.disconnect();
        useCounterStore.getState().reset();
        useTicketStore.getState().reset();
        useQueueStore.getState().reset();
        useOfflineStore.getState().setActor(null);

        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      },

      refreshToken: async () => {
        const { user } = get();
        if (!user) throw new Error("Session absente");

        const bundle = await tokenStorage.getBundle();
        if (!bundle?.refreshToken) {
          throw new Error("Session expirée : reconnectez-vous.");
        }

        const refreshed = await apiService.refresh(bundle.refreshToken);
        const refreshToken = refreshed.refresh_token || bundle.refreshToken;

        await tokenStorage
          .setBundle({
            accessToken: refreshed.access_token,
            refreshToken,
            expiresAt: refreshed.expires_at,
          })
          .catch(() => undefined);
        httpClient.setToken(refreshed.access_token);
        set({
          user: {
            ...user,
            token: refreshed.access_token,
            refresh_token: refreshToken,
            token_expires_at: refreshed.expires_at || user.token_expires_at,
          },
        });
      },

      applyContext: (orgId, branchId) => {
        setApiContext({ orgId, branchId });
        // Changement de poste : rien de l'ancienne agence ne doit survivre
        // (guichet ouvert, file, ticket en cours).
        useCounterStore.getState().reset();
        useTicketStore.getState().reset();
        useQueueStore.getState().reset();
        const { user } = get();
        if (user) {
          set({ user: { ...user, branch_id: branchId } });
        }
      },

      clearError: () => set({ error: null }),

      hasRole: (...roles) => {
        const { user } = get();
        return user ? roles.includes(user.role) : false;
      },

      isAgent: () => get().hasRole("Agent"),
      isSupervisor: () => get().hasRole("Supervisor"),
      isAdmin: () => get().hasRole("BranchAdmin", "OrgAdmin"),
    }),
    {
      name: "tonde-auth",
      // v2 : le token n'est plus jamais persisté dans le localStorage.
      version: 2,
      // v1 stockait le token dans localStorage : cette session est invalidée.
      migrate: (persistedState, version) =>
        version < 2
          ? ({ user: null, isAuthenticated: false } as AuthState)
          : (persistedState as AuthState),
      partialize: (state): Partial<AuthState> => ({
        user: state.user
          ? { ...state.user, token: "", refresh_token: undefined }
          : null,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

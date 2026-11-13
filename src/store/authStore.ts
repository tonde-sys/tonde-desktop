// ============================================================
// TONDE DESKTOP — Auth Store (Zustand)
// Le JWT vit dans le coffre-fort système (tokenStorage),
// jamais dans le localStorage. Réhydratation au démarrage.
// ============================================================

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser, LoginCredentials, EmployeeRole } from "../types";
import { apiService, ApiError, httpClient } from "../services/api/apiService";
import { db } from "../services/database/db";
import { tokenStorage } from "../services/secure/tokenStorage";
import { wsManager } from "../lib/WebSocketManager";
import { useCounterStore } from "./counterStore";
import { useTicketStore } from "./ticketStore";
import { useQueueStore } from "./queueStore";

interface LogoutOptions {
  /** false = pas d'appel réseau (session déjà invalide) */
  remote?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitializing: boolean;
  isInitialized: boolean;
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: (options?: LogoutOptions) => Promise<void>;
  refreshToken: () => Promise<void>;
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
    if (err.status === 401 || err.status === 403) {
      return "Email ou mot de passe incorrect.";
    }
    if (err.status >= 500) {
      return "Le serveur TONDE est momentanément indisponible.";
    }
    return err.message;
  }
  return "Serveur TONDE injoignable. Vérifiez votre connexion.";
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isInitializing: false,
      isInitialized: false,
      error: null,

      initialize: async () => {
        if (get().isInitialized || get().isInitializing) return;
        set({ isInitializing: true });

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
          const token = await tokenStorage.get().catch(() => null);
          const persistedUser = get().user;

          if (token && persistedUser) {
            httpClient.setToken(token);
            set({
              user: { ...persistedUser, token },
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
          } else {
            if (token) {
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
        set({ isLoading: true, error: null });
        try {
          const user = await apiService.login(credentials);

          // Écriture de cache hors du chemin critique : le login réussit
          // même si le coffre ou SQLite est indisponible.
          try {
            await tokenStorage.set(user.token);
          } catch (err) {
            console.warn("[TONDE] Jeton non persisté sur ce poste", err);
          }
          void db.upsertEmployee({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            is_active: true,
            branch_id: user.branch_id,
          });

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (err) {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: friendlyLoginError(err),
          });
        }
      },

      logout: async (options) => {
        if (options?.remote !== false) {
          try {
            await apiService.logout();
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

        const currentToken = await tokenStorage.get();
        if (!currentToken) throw new Error("Jeton d'accès introuvable");

        const refreshed = await apiService.refreshToken(currentToken);
        const token = refreshed.token ?? currentToken;

        await tokenStorage.set(token).catch(() => undefined);
        httpClient.setToken(token);
        set({ user: { ...user, ...refreshed, token } });
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
      partialize: (state) => ({
        user: state.user ? { ...state.user, token: "" } : null,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

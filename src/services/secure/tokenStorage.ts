// ============================================================
// TONDE DESKTOP — Stockage du JWT
// Tauri : coffre-fort du système (commandes Rust keyring)
// Navigateur (dev uniquement) : sessionStorage
// Jamais de token dans le localStorage persistant.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

const DEV_SESSION_KEY = "tonde-dev-token";

export const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const tokenStorage = {
  async get(): Promise<string | null> {
    if (isTauriRuntime()) {
      return invoke<string | null>("secure_get_token");
    }
    return sessionStorage.getItem(DEV_SESSION_KEY);
  },

  async set(token: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("secure_set_token", { token });
      return;
    }
    sessionStorage.setItem(DEV_SESSION_KEY, token);
  },

  async clear(): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("secure_clear_token");
      return;
    }
    sessionStorage.removeItem(DEV_SESSION_KEY);
  },
};

// ============================================================
// TONDE DESKTOP — Stockage des jetons JWT
// Tauri : coffre-fort du système (commandes Rust keyring)
// Navigateur (dev uniquement) : sessionStorage
// Le couple access/refresh est stocké ensemble, jamais dans
// le localStorage persistant.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

const DEV_SESSION_KEY = "tonde-dev-token";

export interface TokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function parseBundle(raw: string | null): TokenBundle | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { accessToken?: unknown }).accessToken === "string"
    ) {
      const bundle = parsed as {
        accessToken: string;
        refreshToken?: unknown;
        expiresAt?: unknown;
      };
      return {
        accessToken: bundle.accessToken,
        refreshToken:
          typeof bundle.refreshToken === "string" ? bundle.refreshToken : undefined,
        expiresAt:
          typeof bundle.expiresAt === "string" ? bundle.expiresAt : undefined,
      };
    }
  } catch {
    // Ancien format : le coffre contenait le token brut.
  }
  return { accessToken: raw };
}

async function readRaw(): Promise<string | null> {
  if (isTauriRuntime()) {
    return invoke<string | null>("secure_get_token");
  }
  return sessionStorage.getItem(DEV_SESSION_KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("secure_set_token", { token: value });
    return;
  }
  sessionStorage.setItem(DEV_SESSION_KEY, value);
}

export const tokenStorage = {
  async getBundle(): Promise<TokenBundle | null> {
    return parseBundle(await readRaw());
  },

  async setBundle(bundle: TokenBundle): Promise<void> {
    await writeRaw(JSON.stringify(bundle));
  },

  // Compatibilité : accès direct au jeton d'accès.
  async get(): Promise<string | null> {
    const bundle = await tokenStorage.getBundle();
    return bundle?.accessToken ?? null;
  },

  async set(token: string): Promise<void> {
    const existing = await tokenStorage.getBundle().catch(() => null);
    await tokenStorage.setBundle({
      accessToken: token,
      refreshToken: existing?.refreshToken,
      expiresAt: existing?.expiresAt,
    });
  },

  async clear(): Promise<void> {
    if (isTauriRuntime()) {
      await invoke("secure_clear_token");
      return;
    }
    sessionStorage.removeItem(DEV_SESSION_KEY);
  },
};

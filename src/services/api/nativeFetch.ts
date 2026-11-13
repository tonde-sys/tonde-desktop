// ============================================================
// TONDE DESKTOP — Fetch natif
// Sous Tauri, les requêtes passent par le client Rust (reqwest) :
// aucune origine WebView n'est envoyée, donc pas de blocage CORS
// par le backend Render. Repli sur fetch en navigateur/tests.
// ============================================================

import { API_TIMEOUT_MS } from "../../config/api";
import { isTauriRuntime } from "../secure/tokenStorage";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

let nativeFetch: FetchFn | null = null;
let nativeUnavailable = false;

async function loadNativeFetch(): Promise<FetchFn> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  return (input, init) =>
    tauriFetch(input, { ...init, connectTimeout: API_TIMEOUT_MS });
}

export async function appFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  if (isTauriRuntime() && !nativeUnavailable) {
    if (!nativeFetch) {
      try {
        nativeFetch = await loadNativeFetch();
      } catch (err) {
        nativeUnavailable = true;
        console.warn(
          "[TONDE] Client HTTP natif indisponible, repli sur fetch",
          err
        );
      }
    }
    if (nativeFetch) return nativeFetch(input, init);
  }
  return fetch(input, init);
}

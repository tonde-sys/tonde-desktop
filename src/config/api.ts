// ============================================================
// TONDE DESKTOP — Config API · Environnements
// ============================================================

type Environment = "development" | "staging" | "production";

const ENV: Environment =
  (import.meta.env.VITE_ENV as Environment) ??
  (import.meta.env.PROD ? "production" : "development");

// API pilote déployée sur Render (Frankfurt, plan gratuit).
// Le service s'endort après 15 min : le premier appel peut dépasser 8 s.
const RENDER_API_URL = "https://tonde-api-pilot-fx1j.onrender.com";

const API_URLS: Record<Environment, string> = {
  development: "http://localhost:8000",
  staging: RENDER_API_URL,
  production: RENDER_API_URL,
};

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL ?? API_URLS[ENV]
).replace(/\/+$/, "");

// Le backend expose REST et WebSocket sur le même hôte.
export const WS_BASE_URL = (
  import.meta.env.VITE_WS_URL ?? API_BASE_URL.replace(/^http/, "ws")
).replace(/\/+$/, "");

export const API_HOST = API_BASE_URL.replace(/^https?:\/\//, "");

// API mock locale : jamais active dans un build de production.
export const IS_MOCK_MODE =
  import.meta.env.DEV &&
  (import.meta.env.VITE_USE_MOCK === "true" || import.meta.env.VITE_USE_MOCK === "1");

// Préfixe REST du backend FastAPI (contrat écosystème TONDE).
// Surchargeable via VITE_API_PREFIX="" si le backend sert la racine.
export const API_PREFIX = import.meta.env.VITE_API_PREFIX ?? "/api/v1";

// Cold start Render : laisser le temps au service gratuit de se réveiller.
export const API_TIMEOUT_MS = 30_000;

// Contexte du poste (multi-tenant). Un agent ne peut pas découvrir son
// organisation via l'API : les valeurs sont fournies au build, sinon
// saisies une fois sur l'écran de sélection du guichet.
export const TONDE_ORG_ID = (import.meta.env.VITE_TONDE_ORG_ID ?? "").trim();
export const TONDE_BRANCH_ID = (import.meta.env.VITE_TONDE_BRANCH_ID ?? "").trim();

// OTP universel DEV uniquement
export const DEV_OTP = ENV === "development" ? "123456" : null;

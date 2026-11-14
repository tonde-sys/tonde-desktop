// ============================================================
// TONDE DESKTOP — useAppUpdate
// Mise à jour automatique signée (plugin updater Tauri v2).
//
// Règles de sécurité opérationnelle :
//  - jamais de redémarrage automatique : un agent peut être en train
//    de servir un ticket, l'installation attend son clic ;
//  - la vérification est silencieuse (aucune erreur affichée si le
//    poste est hors-ligne : le guichet doit continuer à fonctionner) ;
//  - la signature minisign du paquet est validée par le plugin avant
//    toute installation ; un paquet non signé est rejeté.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { IS_MOCK_MODE } from "../config/api";

const FIRST_CHECK_DELAY_MS = 8_000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DISMISS_KEY = "tonde.update.dismissed";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "installing"
  | "ready"
  | "error";

export interface AppUpdateState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  progress: number | null;
  error: string | null;
  install: () => Promise<void>;
  dismiss: () => void;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function useAppUpdate(): AppUpdateState {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<Update | null>(null);
  const mountedRef = useRef(true);

  const checkNow = useCallback(async () => {
    if (!isTauriRuntime() || IS_MOCK_MODE) return;

    try {
      if (mountedRef.current) setStatus("checking");
      const update = await check();

      if (!update) {
        if (mountedRef.current) setStatus("idle");
        return;
      }

      pendingRef.current = update;

      // Une version déjà écartée par l'agent ne revient pas à chaque
      // vérification : on ne relance la demande qu'à la version suivante.
      if (readDismissed() === update.version) {
        if (mountedRef.current) {
          setVersion(update.version);
          setStatus("idle");
        }
        return;
      }

      if (mountedRef.current) {
        setVersion(update.version);
        setNotes(update.body ?? null);
        setStatus("available");
      }
    } catch (err) {
      // Hors-ligne, proxy filtrant, endpoint indisponible : on reste
      // silencieux côté agent, mais on garde la trace pour le support.
      console.warn("[TONDE] vérification de mise à jour impossible:", err);
      if (mountedRef.current) setStatus("idle");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const firstTimer = setTimeout(() => void checkNow(), FIRST_CHECK_DELAY_MS);
    const interval = setInterval(() => void checkNow(), RECHECK_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearTimeout(firstTimer);
      clearInterval(interval);
    };
  }, [checkNow]);

  const install = useCallback(async () => {
    const update = pendingRef.current;
    if (!update) return;

    setStatus("installing");
    setProgress(0);
    setError(null);

    try {
      let total = 0;
      let received = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) {
            setProgress(Math.min(100, Math.round((received / total) * 100)));
          }
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });

      setStatus("ready");
      // Redémarrage explicite : l'installateur MSI a déjà remplacé les
      // binaires, l'ancienne instance doit s'arrêter.
      await relaunch();
    } catch (err) {
      console.error("[TONDE] installation de la mise à jour échouée:", err);
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  const dismiss = useCallback(() => {
    if (version) {
      try {
        localStorage.setItem(DISMISS_KEY, version);
      } catch {
        // Stockage indisponible : la bannière reviendra au prochain lancement.
      }
    }
    setStatus("idle");
  }, [version]);

  return { status, version, notes, progress, error, install, dismiss };
}

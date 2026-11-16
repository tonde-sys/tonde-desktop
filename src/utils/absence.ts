import { ApiError } from "../services/api/apiService";
import type { Ticket } from "../types";

/**
 * Délai de grâce et fenêtre de reprise — côté poste guichet.
 *
 * Le serveur est la SEULE autorité : ces fonctions ne décident jamais à sa
 * place, elles traduisent ses valeurs en quelque chose d'affichable et
 * d'utilisable. La distinction est importante pour `grace_expires_at` :
 *
 *   - le poste l'utilise pour savoir QUAND le bouton devient cliquable ;
 *   - il ne la recalcule JAMAIS depuis `called_at`, parce qu'une relance
 *     repousse l'échéance côté serveur et que le poste n'en saurait rien.
 *
 * Si le champ est absent (serveur plus ancien), on considère la grâce écoulée :
 * mieux vaut laisser l'agent agir et laisser le serveur refuser que bloquer un
 * bouton pour une donnée que le poste ne connaît pas.
 */

/** Secondes restantes avant l'ouverture du bouton « Client absent » (0 = ouvert). */
export function graceSecondsLeft(
  ticket: Pick<Ticket, "grace_expires_at"> | null | undefined,
  nowMs: number = Date.now()
): number {
  const raw = ticket?.grace_expires_at;
  if (!raw) return 0;

  const expiresAt = Date.parse(raw);
  if (Number.isNaN(expiresAt)) return 0;

  return Math.max(0, Math.ceil((expiresAt - nowMs) / 1000));
}

/** Le bouton « Client absent » doit-il être actif ? */
export function canMarkAbsent(
  ticket: Pick<Ticket, "status" | "grace_expires_at"> | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!ticket || ticket.status !== "CALLED") return false;
  return graceSecondsLeft(ticket, nowMs) === 0;
}

export interface AbsenceNotice {
  title: string;
  message: string;
}

/**
 * Traduit un refus du moteur d'absence en message actionnable.
 *
 * Sans ce mapping, l'agent recevait « Impossible de marquer absent » suivi du
 * message brut du serveur — en français technique, sans le nombre de secondes
 * à attendre, alors que le serveur le lui donnait.
 *
 * Retourne `null` quand le code n'est pas un refus du moteur : l'appelant garde
 * alors son message générique.
 */
export function absenceErrorMessage(err: unknown): AbsenceNotice | null {
  if (!(err instanceof ApiError)) return null;

  switch (err.code) {
    case "GRACE_PERIOD_NOT_ELAPSED": {
      const left = err.number("seconds_left");
      return {
        title: "Patientez avant de déclarer absent",
        message:
          left && left > 0
            ? `Le client vient d'être appelé : le bouton s'ouvre dans ${left} s.`
            : "Le client vient d'être appelé : attendez la fin du délai de grâce.",
      };
    }

    case "MAX_MISSED_COUNT_REACHED": {
      const missed = err.number("missed_count");
      const max = err.number("max_missed_count");
      return {
        title: "Reprise impossible",
        message:
          missed && max
            ? `Ce client a déjà manqué ${missed} appel${missed > 1 ? "s" : ""} sur ${max}. Il doit prendre un nouveau ticket.`
            : "Ce client a atteint le nombre d'absences autorisé : il doit prendre un nouveau ticket.",
      };
    }

    case "RECOVERY_WINDOW_EXPIRED":
      return {
        title: "Délai de retour dépassé",
        message:
          "La fenêtre de retour est écoulée : ce ticket ne peut plus être réactivé. Le client doit en prendre un nouveau.",
      };

    case "ACTIVE_TICKET_ALREADY_EXISTS":
      return {
        title: "Ticket déjà en cours",
        message:
          "Ce client a déjà un autre ticket actif : remettre celui-ci en file lui en donnerait deux.",
      };

    case "TICKET_ALREADY_ACTIVE":
      return {
        title: "Ticket déjà en cours",
        message: "Ce client a déjà un ticket actif sur la plateforme.",
      };

    default:
      return null;
  }
}

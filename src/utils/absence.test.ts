import { describe, it, expect } from "vitest";
import {
  absenceErrorMessage,
  canMarkAbsent,
  graceSecondsLeft,
} from "./absence";
import { ApiError } from "../services/api/apiService";
import type { Ticket } from "../types";

const T0 = Date.parse("2026-11-16T10:00:00.000Z");

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "t-1",
    number: "A-001",
    status: "CALLED",
    priority: 0,
    created_at: new Date(T0 - 60_000).toISOString(),
    service_id: "s-1",
    branch_id: "b-1",
    ...over,
  };
}

describe("graceSecondsLeft", () => {
  it("compte les secondes restantes avant l'ouverture du bouton", () => {
    const t = ticket({ grace_expires_at: new Date(T0 + 42_000).toISOString() });
    expect(graceSecondsLeft(t, T0)).toBe(42);
  });

  it("ne descend jamais sous zéro", () => {
    const t = ticket({ grace_expires_at: new Date(T0 - 5_000).toISOString() });
    expect(graceSecondsLeft(t, T0)).toBe(0);
  });

  it("considère la grâce écoulée quand la date est absente", () => {
    // Un serveur plus ancien ne fournit pas `grace_expires_at`. Bloquer le
    // bouton pour une donnée que le poste ne connaît pas serait pire que de
    // laisser le serveur refuser.
    expect(graceSecondsLeft(ticket(), T0)).toBe(0);
  });

  it("ignore une date illisible au lieu de bloquer le bouton", () => {
    const t = ticket({ grace_expires_at: "pas-une-date" });
    expect(graceSecondsLeft(t, T0)).toBe(0);
  });
});

describe("canMarkAbsent", () => {
  it("refuse pendant la grâce", () => {
    const t = ticket({ grace_expires_at: new Date(T0 + 30_000).toISOString() });
    expect(canMarkAbsent(t, T0)).toBe(false);
  });

  it("autorise une fois la grâce écoulée", () => {
    const t = ticket({ grace_expires_at: new Date(T0 - 1_000).toISOString() });
    expect(canMarkAbsent(t, T0)).toBe(true);
  });

  it("refuse un ticket qui n'est pas appelé, même sans grâce", () => {
    expect(canMarkAbsent(ticket({ status: "WAITING" }), T0)).toBe(false);
    expect(canMarkAbsent(ticket({ status: "PROCESSING" }), T0)).toBe(false);
  });

  it("refuse l'absence de ticket", () => {
    expect(canMarkAbsent(null, T0)).toBe(false);
  });
});

describe("absenceErrorMessage", () => {
  it("explique le délai de grâce avec le nombre de secondes du serveur", () => {
    const err = new ApiError(
      "Le client vient d'être appelé",
      409,
      "GRACE_PERIOD_NOT_ELAPSED",
      { seconds_left: 47, grace_period_seconds: 90 }
    );

    const notice = absenceErrorMessage(err);

    expect(notice?.title).toMatch(/Patientez/);
    expect(notice?.message).toContain("47");
  });

  it("explique le plafond d'absences avec les deux compteurs", () => {
    const err = new ApiError("Plafond atteint", 409, "MAX_MISSED_COUNT_REACHED", {
      missed_count: 2,
      max_missed_count: 2,
    });

    const notice = absenceErrorMessage(err);

    expect(notice?.title).toBe("Reprise impossible");
    expect(notice?.message).toContain("2");
  });

  it("explique une fenêtre de reprise expirée", () => {
    const err = new ApiError("Fenêtre écoulée", 409, "RECOVERY_WINDOW_EXPIRED", {
      recovery_expires_at: "2026-11-16T09:00:00Z",
    });

    expect(absenceErrorMessage(err)?.title).toBe("Délai de retour dépassé");
  });

  it("explique un autre ticket actif", () => {
    const err = new ApiError("Déjà actif", 409, "ACTIVE_TICKET_ALREADY_EXISTS", {
      active_ticket_id: "t-9",
    });

    expect(absenceErrorMessage(err)?.title).toBe("Ticket déjà en cours");
  });

  it("laisse passer les erreurs qui ne viennent pas du moteur", () => {
    // Un 500 ou une panne réseau gardent le message générique de l'appelant :
    // les déguiser en règle métier ferait perdre l'information.
    expect(absenceErrorMessage(new ApiError("Boom", 500, "INTERNAL"))).toBeNull();
    expect(absenceErrorMessage(new Error("réseau"))).toBeNull();
    expect(absenceErrorMessage(null)).toBeNull();
  });

  it("tolère un corps d'erreur sans les champs numériques", () => {
    const err = new ApiError("Refus", 409, "GRACE_PERIOD_NOT_ELAPSED");
    expect(absenceErrorMessage(err)?.message).toContain("délai de grâce");
  });
});

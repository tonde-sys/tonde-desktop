import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canPerformAction,
  canTransition,
  getAvailableActions,
} from "./ticket-state-machine";

describe("machine à états ticket", () => {
  it("autorise WAITING → CALLED uniquement depuis l'attente", () => {
    expect(canTransition("WAITING", "CALLED")).toBe(true);
    expect(canTransition("WAITING", "COMPLETED")).toBe(false);
    expect(canTransition("WAITING", "ABSENT")).toBe(false);
  });

  it("autorise la clôture directe d'un ticket CALLED", () => {
    expect(canTransition("CALLED", "COMPLETED")).toBe(true);
    expect(canTransition("CALLED", "ABSENT")).toBe(true);
    expect(canTransition("CALLED", "CANCELLED")).toBe(true);
    expect(canTransition("CALLED", "WAITING")).toBe(false);
  });

  it("interdit toute transition depuis un état terminal", () => {
    for (const terminal of ["COMPLETED", "ABSENT", "CANCELLED"] as const) {
      expect(canTransition(terminal, "WAITING")).toBe(false);
      expect(canTransition(terminal, "CALLED")).toBe(false);
      expect(getAvailableActions(terminal)).toEqual([]);
    }
  });

  it("liste les actions disponibles par statut", () => {
    expect(getAvailableActions("WAITING")).toEqual(["call"]);
    expect(getAvailableActions("CALLED")).toContain("complete");
    expect(getAvailableActions("CALLED")).toContain("markAbsent");
    expect(getAvailableActions("PROCESSING")).toContain("cancel");
    expect(canPerformAction("WAITING", "markAbsent")).toBe(false);
    expect(canPerformAction("CALLED", "markAbsent")).toBe(true);
  });

  it("assertTransition lève une erreur explicite sur transition interdite", () => {
    expect(() => assertTransition("WAITING", "CALLED")).not.toThrow();
    expect(() => assertTransition("COMPLETED", "CALLED")).toThrow(
      /Transition interdite : COMPLETED → CALLED/
    );
  });
});

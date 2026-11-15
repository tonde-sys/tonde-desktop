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
    expect(canTransition("CALLED", "CANCELLED")).toBe(false);
    expect(canTransition("CALLED", "WAITING")).toBe(false);
  });

  it("interdit l'absence et l'annulation depuis un ticket en service, mais autorise INCOMPLETE", () => {
    expect(canTransition("PROCESSING", "COMPLETED")).toBe(true);
    expect(canTransition("PROCESSING", "INCOMPLETE")).toBe(true);
    expect(canTransition("PROCESSING", "ABSENT")).toBe(false);
    expect(canTransition("PROCESSING", "CANCELLED")).toBe(false);
  });

  it("autorise la remise en file ou la clôture depuis ABSENT et INCOMPLETE", () => {
    expect(canTransition("INCOMPLETE", "WAITING")).toBe(true);
    expect(canTransition("INCOMPLETE", "CANCELLED")).toBe(true);
    expect(canTransition("ABSENT", "WAITING")).toBe(true);
    expect(canTransition("ABSENT", "CANCELLED")).toBe(true);
  });

  it("interdit toute transition depuis un état terminal (COMPLETED, CANCELLED)", () => {
    for (const terminal of ["COMPLETED", "CANCELLED"] as const) {
      expect(canTransition(terminal, "WAITING")).toBe(false);
      expect(canTransition(terminal, "CALLED")).toBe(false);
      expect(getAvailableActions(terminal)).toEqual([]);
    }
  });

  it("liste les actions disponibles par statut", () => {
    expect(getAvailableActions("WAITING")).toEqual(["call", "close"]);
    expect(getAvailableActions("CALLED")).toContain("startService");
    expect(getAvailableActions("CALLED")).toContain("complete");
    expect(getAvailableActions("CALLED")).toContain("markAbsent");
    expect(getAvailableActions("PROCESSING")).toEqual([
      "complete",
      "markIncomplete",
      "transfer",
    ]);
    expect(getAvailableActions("INCOMPLETE")).toEqual(["requeue", "close"]);
    expect(getAvailableActions("ABSENT")).toEqual(["requeue", "close"]);
    expect(canPerformAction("WAITING", "markAbsent")).toBe(false);
    expect(canPerformAction("CALLED", "markAbsent")).toBe(true);
    expect(canPerformAction("PROCESSING", "markAbsent")).toBe(false);
    expect(canPerformAction("PROCESSING", "markIncomplete")).toBe(true);
  });

  it("assertTransition lève une erreur explicite sur transition interdite", () => {
    expect(() => assertTransition("WAITING", "CALLED")).not.toThrow();
    expect(() => assertTransition("COMPLETED", "CALLED")).toThrow(
      /Transition interdite : COMPLETED → CALLED/
    );
  });
});

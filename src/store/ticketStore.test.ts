import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket } from "../types";
import { ApiError, apiService } from "../services/api/apiService";
import { useOfflineStore } from "./offlineStore";
import { useAppStore } from "./app.store";
import { useTicketStore } from "./ticketStore";

vi.mock("../services/database/db", () => ({
  db: {
    upsertTicket: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../utils/sound", () => ({
  playAlertSound: vi.fn(),
  playCallSound: vi.fn(),
}));

vi.mock("../services/api/apiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api/apiService")>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      recallTicket: vi.fn(),
    },
  };
});

const ticket: Ticket = {
  id: "ticket-1",
  number: "A-001",
  status: "CALLED",
  priority: 0,
  service_id: "service-1",
  branch_id: "branch-1",
  created_at: "2026-11-16T10:00:00Z",
  called_at: "2026-11-16T10:01:00Z",
};

const recallMock = vi.mocked(apiService.recallTicket);

describe("ticketStore.recall", () => {
  beforeEach(() => {
    recallMock.mockReset();
    useTicketStore.setState({
      currentTicket: ticket,
      processingStartedAt: ticket.called_at ?? null,
      lastRecall: null,
      isLoading: false,
      error: null,
    });
    useOfflineStore.setState({ isOnline: true });
    useAppStore.setState({ notifications: [] });
  });

  it("stores the recalls_left response", async () => {
    recallMock.mockResolvedValue({ recalls_left: 1 });

    await useTicketStore.getState().recall("counter-1");

    expect(recallMock).toHaveBeenCalledWith("ticket-1", "counter-1");
    expect(useTicketStore.getState().lastRecall).toEqual({
      ticketId: "ticket-1",
      recallsLeft: 1,
    });
  });

  it("does not queue an offline recall", async () => {
    useOfflineStore.setState({ isOnline: false });

    await useTicketStore.getState().recall("counter-1");

    expect(recallMock).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().syncQueue).toHaveLength(0);
  });

  it("does not retry an uncertain timeout", async () => {
    recallMock.mockRejectedValue(new ApiError("timeout", 0, "TIMEOUT"));

    await useTicketStore.getState().recall("counter-1");

    expect(recallMock).toHaveBeenCalledTimes(1);
    expect(useOfflineStore.getState().syncQueue).toHaveLength(0);
    expect(useAppStore.getState().notifications[0]?.title).toBe(
      "Résultat du rappel incertain"
    );
  });
});

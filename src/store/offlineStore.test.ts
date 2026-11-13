import { beforeEach, describe, expect, it } from "vitest";
import type { SyncQueueItem, SyncStatus } from "../types";
import { belongsToActor, useOfflineStore } from "./offlineStore";

function makeItem(
  id: string,
  status: SyncStatus,
  payload: Record<string, unknown> = {}
): SyncQueueItem {
  return {
    id,
    action: "COMPLETE_TICKET",
    payload,
    created_at: new Date().toISOString(),
    status,
    retry_count: status === "FAILED" ? 3 : 0,
  };
}

const agentA = { userId: "agent-a", branchId: "branch-1" };

describe("outbox par agent", () => {
  beforeEach(() => {
    useOfflineStore.setState({
      syncQueue: [],
      actor: null,
      isSyncing: false,
      isOnline: true,
    });
  });

  it("ne compte que les actions de l'agent connecté", () => {
    useOfflineStore.setState({
      actor: agentA,
      syncQueue: [
        makeItem("mine-pending", "PENDING", { user_id: "agent-a" }),
        makeItem("other-failed", "FAILED", { user_id: "agent-b" }),
        makeItem("mine-done", "DONE", { user_id: "agent-a" }),
        makeItem("legacy-failed", "FAILED"),
      ],
    });

    const state = useOfflineStore.getState();
    expect(state.getPendingCount()).toBe(1);
    expect(state.getFailedCount()).toBe(1);
    expect(state.hasPending()).toBe(true);
  });

  it("ne rejoue jamais les actions d'un autre agent", async () => {
    useOfflineStore.setState({
      actor: agentA,
      syncQueue: [
        makeItem("other-pending", "PENDING", { user_id: "agent-b" }),
      ],
    });

    await useOfflineStore.getState().syncPending();

    const item = useOfflineStore.getState().syncQueue[0];
    expect(item.status).toBe("PENDING");
  });

  it("rattache une nouvelle action à l'agent courant", async () => {
    useOfflineStore.setState({ actor: agentA, isOnline: false });

    await useOfflineStore.getState().enqueue("PAUSE_COUNTER", {
      counter_id: "counter-1",
    });

    const item = useOfflineStore.getState().syncQueue[0];
    expect(item.payload).toMatchObject({
      counter_id: "counter-1",
      user_id: "agent-a",
      branch_id: "branch-1",
    });
  });

  it("ignore une action sans tag pour un agent connecté", () => {
    // Les actions créées avant cette version n'ont pas de user_id : elles
    // restent rejouables, mais uniquement par l'agent qui les voit.
    expect(belongsToActor(makeItem("legacy", "PENDING"), agentA)).toBe(true);
    expect(belongsToActor(makeItem("legacy", "PENDING"), null)).toBe(true);
    expect(
      belongsToActor(makeItem("other", "PENDING", { user_id: "agent-b" }), agentA)
    ).toBe(false);
    expect(belongsToActor(makeItem("mine", "PENDING", { user_id: "agent-a" }), null)).toBe(
      false
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/api")>();
  return { ...actual, IS_MOCK_MODE: false };
});

import { useQueueStore } from "../store/queueStore";
import { wsManager } from "./WebSocketManager";

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;

  constructor() {
    MockWebSocket.instances.push(this);
  }
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.({ code: 1000 } as CloseEvent);
  });

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe("WebSocketManager counter queue events", () => {
  let socket: MockWebSocket;
  let loadQueues: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    loadQueues = vi.spyOn(useQueueStore.getState(), "loadQueues").mockResolvedValue();
  });

  afterEach(() => {
    wsManager.disconnect();
    loadQueues.mockRestore();
    vi.unstubAllGlobals();
  });

  it("refreshes queues when counter_queue_changed arrives", async () => {
    wsManager.connect("counter-1", "token-1", "branch-1");
    socket = MockWebSocket.instances[0];
    socket.open();

    await vi.waitFor(() => expect(loadQueues).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    socket.receive({
      type: "counter_queue_changed",
      agency_id: "branch-1",
      service_id: "service-1",
      reason: "ticket_recalled",
      ticket_number: "A-001",
      status: "CALLED",
      counter_id: "counter-1",
      counter_name: "Guichet 1",
    });

    await vi.waitFor(() => expect(loadQueues).toHaveBeenCalledTimes(2));
    expect(loadQueues).toHaveBeenLastCalledWith("branch-1");
  });
});

// ============================================================
// TONDE DESKTOP — WebSocket Manager
// Guichet : canal /tickets/ws/counter/{id} (keepalive)
// Le backend ne pousse pas les événements métier aux guichets :
// la file est rafraîchie par polling tant que la session est ouverte.
// ============================================================

import type {
  WebSocketEvent,
  WebSocketEventType,
  QueueUpdatePayload,
  CounterStatusPayload,
} from "../types";
import { API_PREFIX, IS_MOCK_MODE, WS_BASE_URL } from "../config/api";
import { useOfflineStore } from "../store/offlineStore";
import { useQueueStore } from "../store/queueStore";
import { useCounterStore } from "../store/counterStore";

type EventHandler<T = unknown> = (payload: T) => void;

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const POLL_INTERVAL_MS = 7000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class WebSocketManager {
  private ws: WebSocket | null = null;
  private counterId: string | null = null;
  private branchId: string | null = null;
  private token: string | null = null;
  private retryCount = 0;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isIntentionallyClosed = false;
  private handlers = new Map<WebSocketEventType, Set<EventHandler>>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // ---- Public API ----

  connect(counterId: string, token: string, branchId: string): void {
    // Pas de backend temps réel derrière l'API mock.
    if (IS_MOCK_MODE) {
      useOfflineStore.getState().setOnline(true);
      useOfflineStore.getState().setConnectionStatus("CONNECTED");
      return;
    }

    const alreadyConnected =
      this.ws !== null &&
      this.counterId === counterId &&
      this.token === token &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING);
    if (alreadyConnected && this.branchId === branchId) return;

    this.isIntentionallyClosed = true;
    this._clearTimers();
    this.ws?.close(1000, "Reconnect");
    this.ws = null;

    this.counterId = counterId;
    this.branchId = branchId;
    this.token = token;
    this.isIntentionallyClosed = false;
    this.retryCount = 0;

    // Le canal guichet ne reçoit que le keepalive : la file est
    // rafraîchie par polling, même WebSocket connecté.
    this._startPolling();
    this._connect();
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    this._clearTimers();
    this.ws?.close(1000, "User disconnect");
    this.ws = null;
    this.counterId = null;
    this.branchId = null;
    this.token = null;
    useOfflineStore.getState().setConnectionStatus("DISCONNECTED");
  }

  on<T>(event: WebSocketEventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);
    return () => this.handlers.get(event)?.delete(handler as EventHandler);
  }

  send(type: string, payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  // ---- Internal ----

  private _connect(): void {
    if (!this.counterId || !this.token) return;

    useOfflineStore.getState().setConnectionStatus("RECONNECTING");

    const url =
      `${WS_BASE_URL}${API_PREFIX}/tickets/ws/counter/` +
      `${encodeURIComponent(this.counterId)}?token=${encodeURIComponent(this.token)}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.retryCount = 0;
      useOfflineStore.getState().setOnline(true);
      useOfflineStore.getState().setConnectionStatus("CONNECTED");
      this._startPing();
      void this._poll();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: unknown = JSON.parse(event.data);
        this._handleMessage(msg);
      } catch (e) {
        console.error("[WS] Failed to parse message", e);
      }
    };

    this.ws.onclose = (event) => {
      this._stopPing();
      if (this.isIntentionallyClosed) return;

      // Le WebSocket peut tomber alors que l'HTTP fonctionne encore :
      // on signale une reconnexion, pas une perte réseau globale.
      useOfflineStore.getState().setConnectionStatus("RECONNECTING");

      if (event.code !== 1000) {
        this._scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror — nothing extra needed
    };
  }

  private _handleMessage(msg: unknown): void {
    if (!isRecord(msg) || typeof msg.type !== "string") return;
    const rawType = msg.type;

    if (rawType === "connected") {
      useOfflineStore.getState().setConnectionStatus("CONNECTED");
      return;
    }
    if (rawType === "pong") return;

    const type = rawType.toUpperCase() as WebSocketEventType;
    const payload = isRecord(msg.payload)
      ? msg.payload
      : isRecord(msg.data)
        ? msg.data
        : msg;

    this._dispatch({
      type,
      payload,
      branch_id: this.branchId ?? "",
      timestamp: new Date().toISOString(),
    });
  }

  private _dispatch(event: WebSocketEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;

    switch (event.type) {
      case "QUEUE_UPDATE": {
        const p = event.payload as QueueUpdatePayload;
        useQueueStore.getState().updateQueueFromWS(p.service_id, p.tickets, p.waiting_count);
        break;
      }
      case "COUNTER_STATUS": {
        const p = event.payload as CounterStatusPayload;
        useCounterStore.getState().updateCounterFromWS(p.counter);
        break;
      }
    }

    handlers.forEach((h) => h(event.payload));
  }

  private _scheduleReconnect(): void {
    if (this.retryCount >= MAX_RETRIES) {
      console.warn("[WS] Max retries reached. Staying in polling fallback.");
      return;
    }

    const delay = Math.min(
      BASE_DELAY_MS * Math.pow(2, this.retryCount) + Math.random() * 1000,
      MAX_DELAY_MS
    );

    this.retryCount++;
    console.info(`[WS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.retryCount})`);

    this.retryTimeout = setTimeout(() => {
      this._connect();
    }, delay);
  }

  private _startPing(): void {
    this._stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send("ping");
      }
    }, 25000); // Every 25 seconds
  }

  private _stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ---- Polling de la file (le backend ne pousse rien aux guichets) ----

  private _startPolling(): void {
    this._stopPolling();
    console.info("[WS] Queue polling enabled");
    this.pollInterval = setInterval(() => {
      void this._poll();
    }, POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async _poll(): Promise<void> {
    if (!this.branchId) return;
    try {
      const { loadQueues } = useQueueStore.getState();
      await loadQueues(this.branchId);
    } catch {
      // Still offline — polling will retry
    }
  }

  private _clearTimers(): void {
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.retryTimeout = null;
    this._stopPolling();
    this._stopPing();
  }
}

// Singleton
export const wsManager = new WebSocketManager();

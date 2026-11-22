// ============================================================
// TONDE DESKTOP — API Service
// Client HTTP vers le backend FastAPI déployé sur Render.
// Contrat : /api/v1 — auth JWT, counters scopés org/branche,
// tickets guichet, écran public de branche.
// ============================================================

import type {
  AuthUser,
  LoginCredentials,
  Ticket,
  Counter,
  Queue,
  Service,
  Employee,
  EmployeeRole,
  AgentStats,
} from "../../types";
import {
  API_BASE_URL,
  API_PREFIX,
  API_TIMEOUT_MS,
  IS_MOCK_MODE,
  TONDE_BRANCH_ID,
  TONDE_ORG_ID,
} from "../../config/api";
import { appFetch } from "./nativeFetch";

// ---- Mock Data ----

const MOCK_BRANCH_ID = "branch-mock-001";
const MOCK_BRANCH_NAME = "Agence Principale Bujumbura";
const MOCK_USER_ID = "agent-mock-001";

const MOCK_SERVICES: Service[] = [
  { id: "svc-001", name: "Dépôts & Retraits", code: "DEP", branch_id: MOCK_BRANCH_ID, is_active: true },
  { id: "svc-002", name: "Virements", code: "VIR", branch_id: MOCK_BRANCH_ID, is_active: true },
  { id: "svc-003", name: "Change", code: "CHG", branch_id: MOCK_BRANCH_ID, is_active: true },
];

const MOCK_COUNTERS: Counter[] = [
  { id: "counter-001", number: 1, name: "Guichet 1", status: "CLOSED", service_ids: ["svc-001"], branch_id: MOCK_BRANCH_ID },
  { id: "counter-002", number: 2, name: "Guichet 2", status: "CLOSED", service_ids: ["svc-001"], branch_id: MOCK_BRANCH_ID },
  { id: "counter-003", number: 3, name: "Guichet 3", status: "CLOSED", service_ids: ["svc-002"], branch_id: MOCK_BRANCH_ID },
  { id: "counter-004", number: 4, name: "Guichet 4", status: "CLOSED", service_ids: ["svc-003"], branch_id: MOCK_BRANCH_ID },
];

const mockTickets: Ticket[] = [
  { id: "ticket-001", number: "A-001", status: "WAITING", priority: 0, service_id: "svc-001", branch_id: MOCK_BRANCH_ID, created_at: new Date(Date.now() - 300000).toISOString() },
  { id: "ticket-002", number: "A-002", status: "WAITING", priority: 1, service_id: "svc-001", branch_id: MOCK_BRANCH_ID, created_at: new Date(Date.now() - 240000).toISOString() },
  { id: "ticket-003", number: "A-003", status: "WAITING", priority: 0, service_id: "svc-001", branch_id: MOCK_BRANCH_ID, created_at: new Date(Date.now() - 180000).toISOString() },
  { id: "ticket-004", number: "B-001", status: "WAITING", priority: 0, service_id: "svc-002", branch_id: MOCK_BRANCH_ID, created_at: new Date(Date.now() - 150000).toISOString() },
  { id: "ticket-005", number: "B-002", status: "WAITING", priority: 0, service_id: "svc-002", branch_id: MOCK_BRANCH_ID, created_at: new Date(Date.now() - 120000).toISOString() },
  { id: "ticket-006", number: "C-001", status: "WAITING", priority: 1, service_id: "svc-003", branch_id: MOCK_BRANCH_ID, created_at: new Date(Date.now() - 60000).toISOString() },
];

// ---- Mock API Implementation ----

const mockApi = {
  async login(credentials: LoginCredentials): Promise<AuthUser> {
    await delay(500);
    if (credentials.email && credentials.password) {
      return {
        id: MOCK_USER_ID,
        name: credentials.email.split("@")[0].replace(".", " ").replace(/\b\w/g, l => l.toUpperCase()),
        email: credentials.email,
        role: "Agent",
        branch_id: MOCK_BRANCH_ID,
        branch_name: MOCK_BRANCH_NAME,
        counter_id: "counter-001",
        token: "mock-jwt-token-" + Date.now(),
        refresh_token: "mock-refresh-token-" + Date.now(),
        token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
    }
    throw new Error("Email et mot de passe requis");
  },

  async logout(_refreshToken?: string): Promise<void> {
    await delay(200);
  },

  async refreshToken(_refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_at: string }> {
    await delay(200);
    return {
      access_token: "mock-refreshed-token-" + Date.now(),
      refresh_token: "mock-refreshed-refresh-" + Date.now(),
      expires_at: new Date(Date.now() + 900000).toISOString(),
    };
  },

  async callNextTicket(_counterId: string, serviceIds: string[]): Promise<Ticket> {
    await delay(300);
    const availableTickets = mockTickets
      .filter(t => t.status === "WAITING" && serviceIds.includes(t.service_id))
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
    if (availableTickets.length === 0) {
      throw new Error("Aucun ticket en attente");
    }
    const ticket = availableTickets[0];
    ticket.status = "CALLED";
    ticket.called_at = new Date().toISOString();
    return ticket;
  },

  async callTicketById(ticketId: string, _counterId: string): Promise<Ticket> {
    await delay(200);
    const ticket = mockTickets.find(t => t.id === ticketId);
    if (!ticket) throw new Error("Ticket non trouvé");
    ticket.status = "CALLED";
    ticket.called_at = new Date().toISOString();
    return ticket;
  },

  async getTicket(ticketId: string): Promise<Ticket> {
    await delay(100);
    const ticket = mockTickets.find(t => t.id === ticketId);
    if (!ticket) throw new Error("Ticket non trouvé");
    return ticket;
  },

  async recallTicket(_ticketId: string, _counterId: string): Promise<{ recalls_left: number }> {
    await delay(200);
    return { recalls_left: 2 };
  },

  async markTicketAbsent(ticketId: string, _counterId: string): Promise<AbsenceResult> {
    await delay(200);
    const ticket = mockTickets.find(t => t.id === ticketId);
    if (ticket) {
      ticket.status = "ABSENT";
      ticket.closed_at = new Date().toISOString();
      ticket.missed_count = (ticket.missed_count ?? 0) + 1;
    }
    return { missed_count: ticket?.missed_count ?? 1, recovery_allowed: true };
  },

  async startServingTicket(ticketId: string, _counterId: string): Promise<void> {
    await delay(150);
    const ticket = mockTickets.find(t => t.id === ticketId);
    if (ticket) {
      ticket.status = "PROCESSING";
      ticket.served_at = new Date().toISOString();
    }
  },

  async markTicketIncomplete(
    ticketId: string,
    _counterId: string,
    _reason?: string
  ): Promise<void> {
    await delay(200);
    const ticket = mockTickets.find((t) => t.id === ticketId);
    if (ticket) {
      ticket.status = "INCOMPLETE";
    }
  },

  async returnTicketToQueue(ticketId: string): Promise<RequeueResult> {
    await delay(200);
    const ticket = mockTickets.find((t) => t.id === ticketId);
    if (ticket) {
      ticket.status = "WAITING";
      ticket.called_at = undefined;
      ticket.served_at = undefined;
      ticket.closed_at = undefined;
    }
    return { position: 1, queue_degraded: false };
  },

  async requeueTicket(ticketId: string): Promise<void> {
    await delay(200);
    const ticket = mockTickets.find((t) => t.id === ticketId);
    if (ticket) {
      ticket.status = "WAITING";
      ticket.called_at = undefined;
      ticket.served_at = undefined;
      ticket.closed_at = undefined;
    }
  },

  async closeTicket(ticketId: string, _reason?: string): Promise<void> {
    await delay(200);
    const ticket = mockTickets.find((t) => t.id === ticketId);
    if (ticket) {
      ticket.status = "CANCELLED";
      ticket.closed_at = new Date().toISOString();
    }
  },

  async decideTicketPriority(
    ticketId: string,
    options: {
      approve: boolean;
      priority?: "standard" | "priority" | "vip" | "emergency";
    }
  ): Promise<void> {
    await delay(200);
    const ticket = mockTickets.find((t) => t.id === ticketId);
    if (!ticket) return;
    if (options.approve) {
      if (options.priority) {
        ticket.priority =
          options.priority === "vip" || options.priority === "emergency"
            ? 2
            : options.priority === "priority"
              ? 1
              : 0;
      } else if (ticket.requested_priority !== undefined) {
        ticket.priority = ticket.requested_priority;
      }
    }
    ticket.requested_priority = undefined;
  },

  async lookupTicket(codeOrId: string): Promise<Ticket> {
    await delay(150);
    const q = codeOrId.trim().toLowerCase();
    const found = mockTickets.find(
      (t) =>
        t.id.toLowerCase() === q ||
        t.number.toLowerCase() === q ||
        t.number.replace("-", "").toLowerCase() === q.replace("-", "")
    );
    if (!found) {
      throw new ApiError("Ticket introuvable", 404, "TICKET_NOT_FOUND");
    }
    return { ...found };
  },

  async completeTicket(ticketId: string, _counterId: string): Promise<void> {
    await delay(200);
    const ticket = mockTickets.find(t => t.id === ticketId);
    if (ticket) {
      ticket.status = "COMPLETED";
      ticket.closed_at = new Date().toISOString();
    }
  },

  async transferTicket(
    ticketId: string,
    _toCounterId: string,
    _toServiceId: string
  ): Promise<void> {
    await delay(300);
    const ticket = mockTickets.find(t => t.id === ticketId);
    if (ticket) {
      ticket.status = "WAITING";
      ticket.service_id = _toServiceId;
      ticket.called_at = undefined;
    }
  },

  async getCounter(counterId: string): Promise<Counter> {
    await delay(200);
    const counter = MOCK_COUNTERS.find(c => c.id === counterId);
    if (!counter) throw new Error("Guichet non trouvé");
    return counter;
  },

  async getCounters(_branchId: string): Promise<Counter[]> {
    await delay(200);
    return [...MOCK_COUNTERS];
  },

  async pauseCounter(counterId: string, pausedUntil?: string): Promise<void> {
    await delay(200);
    const counter = MOCK_COUNTERS.find(c => c.id === counterId);
    if (counter) {
      counter.status = "PAUSED";
      counter.paused_until = pausedUntil ?? null;
    }
  },

  async resumeCounter(counterId: string): Promise<void> {
    await delay(200);
    const counter = MOCK_COUNTERS.find(c => c.id === counterId);
    if (counter) {
      counter.status = "OPEN";
      counter.paused_until = null;
    }
  },

  async closeCounter(counterId: string): Promise<void> {
    await delay(200);
    const counter = MOCK_COUNTERS.find(c => c.id === counterId);
    if (counter) counter.status = "CLOSED";
  },

  async openCounter(counterId: string, _agentId: string): Promise<void> {
    await delay(300);
    const counter = MOCK_COUNTERS.find(c => c.id === counterId);
    if (counter) {
      counter.status = "OPEN";
      counter.agent_id = _agentId;
    }
  },

  async getQueues(_branchId: string): Promise<Queue[]> {
    await delay(200);
    return MOCK_SERVICES.map(service => ({
      service_id: service.id,
      service_name: service.name,
      waiting_count: mockTickets.filter(t => t.service_id === service.id && t.status === "WAITING").length,
      called_count: mockTickets.filter(t => t.service_id === service.id && t.status === "CALLED").length,
      tickets: mockTickets.filter(t => t.service_id === service.id),
    }));
  },

  async getServices(_branchId: string): Promise<Service[]> {
    await delay(200);
    return [...MOCK_SERVICES];
  },

  async getEmployees(_branchId: string): Promise<Employee[]> {
    await delay(200);
    return [];
  },

  async createEmployee(_data: Partial<Employee>): Promise<Employee> {
    await delay(300);
    return _data as Employee;
  },

  async updateEmployee(id: string, _data: Partial<Employee>): Promise<Employee> {
    await delay(300);
    return { id, name: "", email: "", role: "Agent", is_active: true, branch_id: MOCK_BRANCH_ID };
  },

  async deactivateEmployee(_id: string): Promise<void> {
    await delay(200);
  },

  async getAgentStats(_agentId: string, _date: string): Promise<AgentStats> {
    await delay(200);
    return {
      agent_id: _agentId,
      date: _date,
      tickets_served: 12,
      avg_processing_time_minutes: 4.5,
      total_processing_time_minutes: 54,
      absent_count: 1,
      transferred_count: 2,
    };
  },

  async getBranchStats(_branchId: string, _date: string): Promise<unknown> {
    await delay(200);
    return { total_served: 45, avg_wait_time: 8.2 };
  },
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- HTTP Client ----

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /**
   * Corps d'erreur brut renvoyé par le serveur (`detail` ou `error`).
   *
   * Il est conservé ENTIER, et pas seulement `code`/`message`, parce que le
   * moteur d'absence y met des valeurs dont l'interface a besoin pour agir :
   * `seconds_left` et `grace_period_seconds` (409 GRACE_PERIOD_NOT_ELAPSED),
   * `missed_count` et `max_missed_count` (409 MAX_MISSED_COUNT_REACHED),
   * `recovery_expires_at` (409 RECOVERY_WINDOW_EXPIRED). Les jeter obligeait
   * l'agent à lire un message générique au lieu de savoir combien de secondes
   * attendre.
   */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    status = 0,
    code?: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Nombre du corps d'erreur, ou undefined s'il est absent ou mal typé. */
  number(key: string): number | undefined {
    const value = this.details?.[key];
    return typeof value === "number" ? value : undefined;
  }

  /** Chaîne du corps d'erreur, ou undefined. */
  text(key: string): string | undefined {
    const value = this.details?.[key];
    return typeof value === "string" ? value : undefined;
  }
}

type RefreshHandler = () => Promise<string | null>;
type UnauthorizedHandler = () => void | Promise<void>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) return payload;
  if (isRecord(payload)) {
    // Contrat TONDE : { detail: { code, message } }
    if (isRecord(payload.detail) && typeof payload.detail.message === "string") {
      return payload.detail.message;
    }
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
    // Contrat d'erreur standard : { success: false, error: { code, message } }
    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  }
  return fallback;
}

function extractErrorCode(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.detail) && typeof payload.detail.code === "string") {
    return payload.detail.code;
  }
  if (isRecord(payload.error) && typeof payload.error.code === "string") {
    return payload.error.code;
  }
  return typeof payload.code === "string" ? payload.code : undefined;
}

/**
 * Corps d'erreur complet, pour les valeurs dont l'interface a besoin d'agir
 * (`seconds_left`, `missed_count`, `recovery_expires_at`…).
 */
function extractErrorDetails(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.detail)) return payload.detail;
  if (isRecord(payload.error)) return payload.error;
  return undefined;
}

function unwrapEnvelope<T>(payload: unknown, status: number): T {
  // Contrat écosystème : { success, data, message }
  if (isRecord(payload) && typeof payload.success === "boolean") {
    if (!payload.success) {
      throw new ApiError(
        extractErrorMessage(payload, "Opération refusée par le serveur"),
        status,
        extractErrorCode(payload),
        extractErrorDetails(payload)
      );
    }
    // Les réponses d'auth sont plates : { success, access_token, ... }
    if ("data" in payload) {
      return payload.data as T;
    }
    return payload as T;
  }
  return payload as T;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

class ApiClient {
  private token: string | null = null;
  private refreshHandler: RefreshHandler | null = null;
  private unauthorizedHandler: UnauthorizedHandler | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  setToken(token: string): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = null;
  }

  setRefreshHandler(handler: RefreshHandler | null): void {
    this.refreshHandler = handler;
  }

  setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
    this.unauthorizedHandler = handler;
  }

  // Un seul refresh à la fois : le backend révoque l'ancien refresh token
  // à chaque rotation, deux rotations concurrentes déconnectent l'agent.
  private refreshOnce(): Promise<string | null> {
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          return (await this.refreshHandler?.()) ?? null;
        } finally {
          this.refreshPromise = null;
        }
      })();
    }
    return this.refreshPromise;
  }

  private async send(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      return await appFetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new ApiError(
          "Le serveur TONDE ne répond pas (délai dépassé).",
          0,
          "TIMEOUT"
        );
      }
      throw new ApiError(
        "Serveur TONDE injoignable. Vérifiez votre connexion.",
        0,
        "NETWORK"
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    allowRefresh = true
  ): Promise<T> {
    const tokenAtRequest = this.token;
    const res = await this.send(method, path, body);
    const payload: unknown = await res.json().catch(() => null);

    const isAuthPath = path.startsWith("/auth/");
    if (
      res.status === 401 &&
      allowRefresh &&
      !isAuthPath &&
      this.refreshHandler
    ) {
      // Une requête parallèle a déjà renouvelé le token pendant ce vol.
      if (this.token && this.token !== tokenAtRequest) {
        return this.request<T>(method, path, body, false);
      }
      const newToken = await this.refreshOnce();
      if (newToken) {
        this.token = newToken;
        return this.request<T>(method, path, body, false);
      }
      await this.unauthorizedHandler?.();
    }

    if (!res.ok) {
      throw new ApiError(
        extractErrorMessage(payload, `Erreur serveur (${res.status})`),
        res.status,
        extractErrorCode(payload),
        extractErrorDetails(payload)
      );
    }

    return unwrapEnvelope<T>(payload, res.status);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}

export const httpClient = new ApiClient();

// ---- Contexte du poste (organisation / agence) ----

export interface ApiContext {
  orgId: string;
  branchId: string;
}

const CONTEXT_STORAGE_KEY = "tonde-api-context";

let apiContext: ApiContext | null = null;

function readStoredContext(): ApiContext | null {
  try {
    const raw = localStorage.getItem(CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      isRecord(parsed) &&
      typeof parsed.orgId === "string" &&
      typeof parsed.branchId === "string" &&
      parsed.orgId.trim() &&
      parsed.branchId.trim()
    ) {
      return { orgId: parsed.orgId.trim(), branchId: parsed.branchId.trim() };
    }
  } catch {
    // Valeur corrompue : ignorée, le poste redemandera sa configuration.
  }
  return null;
}

export function getApiContext(): ApiContext | null {
  if (apiContext) return apiContext;
  if (TONDE_ORG_ID && TONDE_BRANCH_ID) {
    apiContext = { orgId: TONDE_ORG_ID, branchId: TONDE_BRANCH_ID };
    return apiContext;
  }
  apiContext = readStoredContext();
  return apiContext;
}

export function setApiContext(context: ApiContext | null): void {
  apiContext = context;
  try {
    if (context) {
      localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(context));
    } else {
      localStorage.removeItem(CONTEXT_STORAGE_KEY);
    }
  } catch {
    // localStorage indisponible : le contexte reste en mémoire.
  }
}

export function hasApiContext(): boolean {
  return getApiContext() !== null;
}

function requireApiContext(): ApiContext {
  const context = getApiContext();
  if (!context) {
    throw new ApiError(
      "Configuration du poste incomplète : renseignez l'organisation et l'agence.",
      0,
      "CONTEXT_REQUIRED"
    );
  }
  return context;
}

// ---- Mapping backend → domaine desktop ----

const ROLE_MAP: Record<string, EmployeeRole> = {
  agent: "Agent",
  supervisor: "Supervisor",
  admin_agency: "BranchAdmin",
  admin_org: "OrgAdmin",
  super_admin: "OrgAdmin",
};

interface BackendMembership {
  employee_id: string;
  org_id: string;
  branch_id: string | null;
  counter_id: string | null;
  role: string;
  status: string;
}

interface BackendAuthUser {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  language: string;
  is_verified: boolean;
  org_id?: string | null;
  memberships?: BackendMembership[];
}

interface BackendAuthResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  user: BackendAuthUser;
}

interface BackendRefreshResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
}

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

interface BackendCounter {
  id: string;
  org_id: string;
  agency_id: string;
  name: string;
  description: string | null;
  is_open: boolean;
  is_active: boolean;
  is_paused?: boolean;
  paused_until?: string | null;
  current_ticket_id: string | null;
}

/**
 * Réponse de `POST /tickets/{id}/absent` (spécification §5.1).
 *
 * Le serveur dit ce qu'il a fait, le poste ne le devine pas : combien d'appels
 * manqués sont consommés, et si le client a encore le droit de revenir.
 */
export interface AbsenceResult {
  missed_count?: number;
  recovery_allowed?: boolean;
  recovery_expires_at?: string;
}

/**
 * Réponse de `POST /tickets/{id}/return`.
 *
 * `queue_degraded` prévient que le ticket est revenu en base mais pas dans la
 * file Redis : la position annoncée n'existe pas encore.
 */
export interface RequeueResult {
  position?: number;
  priority?: string;
  missed_count?: number;
  queue_degraded?: boolean;
}

interface BackendTicket {
  id: string;
  number: string;
  status: string;
  priority: string;
  requested_priority?: string | null;
  agency_id: string;
  service_id: string;
  created_at: string;
  counter_name: string | null;
  called_at?: string | null;
  served_at?: string | null;
  done_at?: string | null;
  // Moteur d'absence et de reprise — déclarés explicitement, sinon `mapTicket`
  // les jetterait silencieusement (le DTO est la seule source du mapping).
  grace_expires_at?: string | null;
  recovery_expires_at?: string | null;
  missed_count?: number | null;
  queue_sequence?: number | null;
  queue_degraded?: boolean | null;
  // Identité du client (anti-fraude — renseignée côté staff)
  client_name?: string | null;
  client_phone?: string | null;
}

interface BackendService {
  id: string;
  name: string;
  ticket_prefix: string;
  avg_duration_minutes: number;
  is_active: boolean;
  branch_id: string;
}

interface BackendDisplay {
  branch: { id: string; name: string; is_open: boolean };
  counters: Array<{ id: string; name: string; is_open: boolean; now_serving: string | null }>;
  services: Array<{
    id: string;
    name: string;
    ticket_prefix: string;
    waiting: number;
    estimated_wait_minutes: number | null;
    last_called_number: string | null;
  }>;
  generated_at: string;
}

interface BackendCallNext {
  success: boolean;
  ticket_id?: string;
  ticket_number?: string;
  counter_name?: string;
  message?: string;
  client_name?: string | null;
  client_phone?: string | null;
}

interface BackendEmployee {
  id: string;
  org_id: string;
  user_id: string;
  agency_id: string | null;
  counter_id: string | null;
  role: string;
  status: string;
}

function decodeJwtExpiry(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(atob(padded));
    if (isRecord(parsed) && typeof parsed.exp === "number") {
      return new Date(parsed.exp * 1000).toISOString();
    }
  } catch {
    // Jeton opaque (mock) ou payload illisible : expiration inconnue.
  }
  return "";
}

function counterNumber(name: string): number {
  const match = name.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function mapCounter(dto: BackendCounter): Counter {
  return {
    id: dto.id,
    number: counterNumber(dto.name),
    name: dto.name,
    description: dto.description ?? undefined,
    status: dto.is_paused ? "PAUSED" : dto.is_open ? "OPEN" : "CLOSED",
    paused_until: dto.paused_until ?? null,
    // Le backend ne rattache pas de services à un guichet : toutes les
    // files de l'agence sont candidates à l'appel.
    service_ids: [],
    branch_id: dto.agency_id,
    is_active: dto.is_active,
    current_ticket_id: dto.current_ticket_id ?? null,
  };
}

function mapService(dto: BackendService): Service {
  return {
    id: dto.id,
    name: dto.name,
    code: dto.ticket_prefix,
    branch_id: dto.branch_id,
    is_active: dto.is_active,
    avg_processing_minutes: dto.avg_duration_minutes,
  };
}

const TICKET_STATUS_MAP: Record<string, Ticket["status"]> = {
  waiting: "WAITING",
  called: "CALLED",
  serving: "PROCESSING",
  processing: "PROCESSING",
  incomplete: "INCOMPLETE",
  done: "COMPLETED",
  completed: "COMPLETED",
  absent: "ABSENT",
  transferred: "CANCELLED",
  cancelled: "CANCELLED",
};

function mapTicketPriority(priority: string): Ticket["priority"] {
  if (priority === "vip" || priority === "emergency") return 2;
  if (priority === "priority") return 1;
  return 0;
}

function mapTicket(dto: BackendTicket): Ticket {
  const realCalledAt = dto.called_at ?? dto.served_at ?? undefined;
  return {
    id: dto.id,
    number: dto.number,
    status: TICKET_STATUS_MAP[dto.status] ?? "WAITING",
    priority: mapTicketPriority(dto.priority),
    requested_priority: dto.requested_priority
      ? mapTicketPriority(dto.requested_priority)
      : undefined,
    created_at: dto.created_at,
    called_at:
      realCalledAt ??
      (dto.status === "called" || dto.status === "serving"
        ? new Date().toISOString()
        : undefined),
    served_at: dto.served_at ?? undefined,
    closed_at: dto.done_at ?? undefined,
    service_id: dto.service_id,
    branch_id: dto.agency_id,
    // Le serveur est la seule autorité sur ces valeurs : on les recopie telles
    // quelles, sans les recalculer ni leur donner de défaut inventé. Un champ
    // absent doit rester `undefined` — sinon l'interface croirait, par exemple,
    // que la grâce est écoulée parce que la date manque.
    grace_expires_at: dto.grace_expires_at ?? undefined,
    recovery_expires_at: dto.recovery_expires_at ?? undefined,
    missed_count: dto.missed_count ?? undefined,
    queue_sequence: dto.queue_sequence ?? undefined,
    queue_degraded: dto.queue_degraded ?? undefined,
    client_name: dto.client_name ?? undefined,
    client_phone: dto.client_phone ?? undefined,
  };
}

function mapEmployee(dto: BackendEmployee): Employee {
  return {
    id: dto.user_id || dto.id,
    name: "",
    email: "",
    role: ROLE_MAP[dto.role] ?? "Agent",
    is_active: dto.status === "active",
    branch_id: dto.agency_id ?? "",
    counter_id: dto.counter_id ?? undefined,
  };
}

const DEVICE_ID_KEY = "tonde-device-id";

function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return "tonde-desktop";
  }
}

// ---- API Service ----

// Export mock API pour les tests
export const mockApiService = mockApi;

// Si VITE_USE_MOCK=true, on utilise le mock
const apiImpl = IS_MOCK_MODE ? mockApi : null;

function pickMembership(
  user: BackendAuthUser,
  preferredOrgId?: string,
  preferredBranchId?: string
): BackendMembership | null {
  const list = (user.memberships ?? []).filter(
    (m) => Boolean(m.org_id) && m.status !== "inactive"
  );
  if (list.length === 0) return null;

  if (preferredOrgId && preferredBranchId) {
    const exact = list.find(
      (m) => m.org_id === preferredOrgId && m.branch_id === preferredBranchId
    );
    if (exact) return exact;
  }

  if (preferredOrgId) {
    const sameOrgWithBranch = list.find(
      (m) => m.org_id === preferredOrgId && Boolean(m.branch_id)
    );
    if (sameOrgWithBranch) return sameOrgWithBranch;
  }

  return (
    list.find((m) => Boolean(m.branch_id) && Boolean(m.counter_id)) ??
    list.find((m) => Boolean(m.branch_id)) ??
    list[0]
  );
}

/**
 * Résout l'organisation, l'agence et le guichet affecté après connexion.
 * Ordre de priorité :
 * 1. Valeurs du build (VITE_TONDE_ORG_ID / VITE_TONDE_BRANCH_ID) ;
 * 2. Rattachements staff actifs (`user.memberships`) renvoyés par le backend ;
 * 3. Contexte déjà enregistré sur le poste s'il appartient à la même organisation ;
 * 4. Découverte de la première agence pour les rôles d'administration.
 */
async function resolveContextAfterLogin(
  role: EmployeeRole,
  user: BackendAuthUser
): Promise<BackendMembership | null> {
  if (TONDE_ORG_ID && TONDE_BRANCH_ID) {
    setApiContext({ orgId: TONDE_ORG_ID, branchId: TONDE_BRANCH_ID });
    return pickMembership(user, TONDE_ORG_ID, TONDE_BRANCH_ID);
  }

  const existing = getApiContext();
  const membership = pickMembership(
    user,
    existing?.orgId,
    existing?.branchId
  );

  if (membership?.org_id && membership.branch_id) {
    setApiContext({
      orgId: membership.org_id,
      branchId: membership.branch_id,
    });
    return membership;
  }

  const knownOrgId = membership?.org_id ?? user.org_id ?? undefined;
  if (existing && (!knownOrgId || existing.orgId === knownOrgId)) {
    return membership;
  }

  if (role === "Agent" || role === "Supervisor") return membership;

  try {
    let orgId = knownOrgId;
    if (!orgId) {
      const organizations = await httpClient.get<Paginated<{ id: string }>>(
        "/organizations?page_size=1"
      );
      orgId = organizations.items?.[0]?.id;
    }
    if (!orgId) return membership;
    const branches = await httpClient.get<Paginated<{ id: string }>>(
      `/organizations/${orgId}/branches?page_size=1`
    );
    const branchId = branches.items?.[0]?.id;
    if (!branchId) return membership;
    setApiContext({ orgId, branchId });
  } catch {
    // Découverte impossible (rôle sans accès) : configuration manuelle.
  }
  return membership;
}

async function fetchBranchDisplay(branchId: string): Promise<BackendDisplay> {
  return httpClient.get<BackendDisplay>(`/branches/${branchId}/display`);
}

/** Sonde de récupération réseau : légère, sans authentification. */
export async function checkBackendHealth(): Promise<boolean> {
  const controller = new AbortController();
  // Cold start Render : 5 s échouent systématiquement pendant le réveil.
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await appFetch(`${API_BASE_URL}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function closeCounterRemote(counterId: string): Promise<void> {
  const context = requireApiContext();
  try {
    await httpClient.post(
      `/organizations/${context.orgId}/branches/${context.branchId}/counters/${counterId}/close`
    );
  } catch (err) {
    if (err instanceof ApiError && err.code === "COUNTER_ALREADY_CLOSED") return;
    throw err;
  }
}

async function pauseCounterRemote(
  counterId: string,
  pausedUntil?: string
): Promise<void> {
  const context = requireApiContext();
  try {
    await httpClient.post(
      `/organizations/${context.orgId}/branches/${context.branchId}/counters/${counterId}/pause`,
      pausedUntil ? { paused_until: pausedUntil } : undefined
    );
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.code === "COUNTER_ALREADY_PAUSED"
    ) return;
    throw err;
  }
}

async function resumeCounterRemote(counterId: string): Promise<void> {
  const context = requireApiContext();
  try {
    await httpClient.post(
      `/organizations/${context.orgId}/branches/${context.branchId}/counters/${counterId}/resume`
    );
  } catch (err) {
    if (err instanceof ApiError && err.code === "COUNTER_NOT_PAUSED") return;
    throw err;
  }
}

async function openCounterRemote(
  counterId: string,
  allowAlreadyOpen = false
): Promise<void> {
  const context = requireApiContext();
  try {
    await httpClient.post(
      `/organizations/${context.orgId}/branches/${context.branchId}/counters/${counterId}/open`
    );
  } catch (err) {
    if (
      allowAlreadyOpen &&
      err instanceof ApiError &&
      err.code === "COUNTER_ALREADY_OPEN"
    ) {
      return;
    }
    throw err;
  }
}

export const apiService = {
  // ---- Auth ----

  async login(credentials: LoginCredentials): Promise<AuthUser> {
    if (apiImpl) return apiImpl.login(credentials);

    const auth = await httpClient.post<BackendAuthResponse>("/auth/login", {
      email: credentials.email,
      password: credentials.password,
      device_id: getDeviceId(),
    });

    const role = ROLE_MAP[auth.user.role];
    if (!role) {
      throw new ApiError(
        "Ce compte n'a pas accès au poste guichet.",
        403,
        "ROLE_NOT_ALLOWED"
      );
    }

    httpClient.setToken(auth.access_token);
    const membership = await resolveContextAfterLogin(role, auth.user);

    const context = getApiContext();

    return {
      id: auth.user.id,
      name: auth.user.name ?? auth.user.email ?? "Agent",
      email: auth.user.email ?? "",
      role,
      branch_id: context?.branchId ?? membership?.branch_id ?? "",
      branch_name: "",
      counter_id: membership?.counter_id ?? undefined,
      token: auth.access_token,
      refresh_token: auth.refresh_token,
      token_expires_at: decodeJwtExpiry(auth.access_token),
    };
  },

  async hydrateSessionContext(
    role: EmployeeRole
  ): Promise<{ branchId: string; counterId?: string } | null> {
    if (apiImpl) return null;
    try {
      const profile = await httpClient.get<BackendAuthUser>("/auth/me");
      const membership = await resolveContextAfterLogin(role, profile);
      const context = getApiContext();
      return {
        branchId: context?.branchId ?? membership?.branch_id ?? "",
        counterId: membership?.counter_id ?? undefined,
      };
    } catch {
      return null;
    }
  },

  async logout(refreshToken?: string): Promise<void> {
    if (apiImpl) return apiImpl.logout(refreshToken);
    try {
      if (refreshToken) {
        await httpClient.post("/auth/logout", { refresh_token: refreshToken });
      }
    } finally {
      httpClient.clearToken();
    }
  },

  async refresh(
    refreshToken: string
  ): Promise<{ access_token: string; refresh_token: string; expires_at: string }> {
    if (apiImpl) return apiImpl.refreshToken(refreshToken);
    const data = await httpClient.post<BackendRefreshResponse>("/auth/refresh", {
      refresh_token: refreshToken,
    });
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: decodeJwtExpiry(data.access_token),
    };
  },

  // ---- Tickets ----

  async callNextTicket(counterId: string, serviceIds: string[]): Promise<Ticket> {
    if (apiImpl) return apiImpl.callNextTicket(counterId, serviceIds);

    const context = requireApiContext();
    const display = await fetchBranchDisplay(context.branchId);
    const candidates = display.services.filter(
      (service) => serviceIds.length === 0 || serviceIds.includes(service.id)
    );

    if (candidates.length === 0) {
      throw new ApiError(
        "Aucun service actif pour cette agence.",
        409,
        "NO_SERVICE"
      );
    }

    const target = [...candidates].sort((a, b) => b.waiting - a.waiting)[0];
    if (target.waiting <= 0) {
      throw new ApiError("Aucun ticket en attente", 409, "QUEUE_EMPTY");
    }

    const result = await httpClient.post<BackendCallNext>(
      "/tickets/counter/call-next",
      {
        agency_id: context.branchId,
        service_id: target.id,
        counter_id: counterId,
      }
    );

    if (!result?.ticket_id || !result.ticket_number) {
      throw new ApiError(
        result?.message ?? "Aucun ticket en attente",
        409,
        "QUEUE_EMPTY"
      );
    }

    const now = new Date().toISOString();
    const fallbackTicket: Ticket = {
      id: result.ticket_id,
      number: result.ticket_number,
      status: "CALLED",
      priority: 0,
      service_id: target.id,
      branch_id: context.branchId,
      created_at: now,
      called_at: now,
      // Identité du client depuis call-next (au cas où le GET /tickets/{id}
      // qui suit échoue — le guichetier a quand même l'info anti-fraude).
      client_name: result.client_name ?? undefined,
      client_phone: result.client_phone ?? undefined,
    };

    try {
      const dto = await httpClient.get<BackendTicket>(
        `/tickets/${result.ticket_id}`
      );
      return mapTicket(dto);
    } catch {
      return fallbackTicket;
    }
  },

  async callTicketById(_ticketId: string, _counterId: string): Promise<Ticket> {
    if (apiImpl) return apiImpl.callTicketById(_ticketId, _counterId);
    // Le backend n'expose pas d'appel par identifiant : la file est
    // toujours servie dans l'ordre (/tickets/counter/call-next).
    throw new ApiError(
      "L'appel d'un ticket précis n'est pas disponible hors ligne.",
      501,
      "NOT_SUPPORTED"
    );
  },

  async getTicket(ticketId: string): Promise<Ticket> {
    if (apiImpl) return apiImpl.getTicket(ticketId);
    const dto = await httpClient.get<BackendTicket>(`/tickets/${ticketId}`);
    return mapTicket(dto);
  },

  async recallTicket(
    ticketId: string,
    _counterId: string
  ): Promise<{ recalls_left: number; recall_count?: number; timeout_seconds?: number }> {
    if (apiImpl) return apiImpl.recallTicket(ticketId, _counterId);
    // Une relance REPOSE le délai de grâce côté serveur : le poste doit donc
    // récupérer `timeout_seconds` pour réarmer son compte à rebours, sinon il
    // croirait la grâce écoulée alors qu'elle vient d'être repoussée.
    return httpClient.post<{
      recalls_left: number;
      recall_count?: number;
      timeout_seconds?: number;
    }>(`/tickets/${ticketId}/recall`);
  },

  async markTicketAbsent(
    ticketId: string,
    _counterId: string
  ): Promise<AbsenceResult> {
    if (apiImpl) return apiImpl.markTicketAbsent(ticketId, _counterId);
    try {
      return await httpClient.post<AbsenceResult>(`/tickets/${ticketId}/absent`);
    } catch (err) {
      // Rejeu après coupure : le ticket peut déjà être absent ou clos.
      if (!(err instanceof ApiError && err.code === "INVALID_TRANSITION")) {
        throw err;
      }
      return {};
    }
  },

  async startServingTicket(ticketId: string, _counterId: string): Promise<void> {
    if (apiImpl) return apiImpl.startServingTicket(ticketId, _counterId);
    try {
      await httpClient.post(`/tickets/${ticketId}/serving`);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "INVALID_TRANSITION")) {
        throw err;
      }
    }
  },

  async markTicketIncomplete(
    ticketId: string,
    _counterId: string,
    reason?: string
  ): Promise<void> {
    if (apiImpl) {
      return apiImpl.markTicketIncomplete(ticketId, _counterId, reason);
    }
    try {
      await httpClient.post(
        `/tickets/${ticketId}/incomplete`,
        reason ? { reason } : undefined
      );
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "INVALID_TRANSITION")) {
        throw err;
      }
    }
  },

  async returnTicketToQueue(ticketId: string): Promise<RequeueResult> {
    if (apiImpl) return apiImpl.returnTicketToQueue(ticketId);
    return httpClient.post<RequeueResult>(`/tickets/${ticketId}/return`);
  },

  async requeueTicket(ticketId: string): Promise<void> {
    if (apiImpl) return apiImpl.requeueTicket(ticketId);
    await httpClient.post(`/tickets/${ticketId}/requeue`);
  },

  async closeTicket(ticketId: string, reason?: string): Promise<void> {
    if (apiImpl) return apiImpl.closeTicket(ticketId, reason);
    await httpClient.post(
      `/tickets/${ticketId}/close`,
      reason ? { reason } : undefined
    );
  },

  async decideTicketPriority(
    ticketId: string,
    options: {
      approve: boolean;
      priority?: "standard" | "priority" | "vip" | "emergency";
    }
  ): Promise<void> {
    if (apiImpl) return apiImpl.decideTicketPriority(ticketId, options);
    await httpClient.post(`/tickets/${ticketId}/priority`, options);
  },

  async lookupTicket(codeOrId: string): Promise<Ticket> {
    const trimmed = codeOrId.trim();
    if (!trimmed) {
      throw new ApiError("Saisissez un code QR ou un identifiant de ticket", 400);
    }
    if (apiImpl) return apiImpl.lookupTicket(trimmed);

    try {
      const qrData = await httpClient.get<{
        ticket_id?: string;
        number: string;
        status: string;
        priority: string;
        requested_priority?: string | null;
        agency_id?: string;
        service_id?: string;
        created_at: string;
      }>(`/tickets/qr/${encodeURIComponent(trimmed)}`);

      if (qrData.ticket_id) {
        return await this.getTicket(qrData.ticket_id);
      }
      return mapTicket({
        id: trimmed,
        number: qrData.number,
        status: qrData.status,
        priority: qrData.priority,
        requested_priority: qrData.requested_priority,
        agency_id: qrData.agency_id ?? getApiContext()?.branchId ?? "",
        service_id: qrData.service_id ?? "",
        created_at: qrData.created_at,
        counter_name: null,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return await this.getTicket(trimmed);
      }
      throw err;
    }
  },

  async completeTicket(ticketId: string, _counterId: string): Promise<void> {
    if (apiImpl) return apiImpl.completeTicket(ticketId, _counterId);
    // CALLED → SERVING → DONE. Les transitions déjà franchies (rejeu
    // après coupure réseau) sont considérées comme appliquées.
    try {
      await httpClient.post(`/tickets/${ticketId}/serving`);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "INVALID_TRANSITION")) {
        throw err;
      }
    }
    try {
      await httpClient.post(`/tickets/${ticketId}/done`);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "INVALID_TRANSITION")) {
        throw err;
      }
    }
  },

  async transferTicket(
    ticketId: string,
    _toCounterId: string,
    toServiceId: string
  ): Promise<void> {
    if (apiImpl) return apiImpl.transferTicket(ticketId, _toCounterId, toServiceId);
    await httpClient.post(`/tickets/${ticketId}/transfer`, {
      target_service_id: toServiceId,
    });
  },

  // ---- Counters ----

  async getCounter(counterId: string): Promise<Counter> {
    if (apiImpl) return apiImpl.getCounter(counterId);
    const context = requireApiContext();
    const dto = await httpClient.get<BackendCounter>(
      `/organizations/${context.orgId}/branches/${context.branchId}/counters/${counterId}`
    );
    return mapCounter(dto);
  },

  async getCounters(branchId: string): Promise<Counter[]> {
    if (apiImpl) return apiImpl.getCounters(branchId);
    const context = requireApiContext();
    const data = await httpClient.get<Paginated<BackendCounter>>(
      `/organizations/${context.orgId}/branches/${branchId}/counters?page_size=100&active_only=true`
    );
    return (data.items ?? []).map(mapCounter);
  },

  async pauseCounter(counterId: string, pausedUntil?: string): Promise<void> {
    if (apiImpl) return apiImpl.pauseCounter(counterId, pausedUntil);
    await pauseCounterRemote(counterId, pausedUntil);
  },

  async resumeCounter(counterId: string): Promise<void> {
    if (apiImpl) return apiImpl.resumeCounter(counterId);
    await resumeCounterRemote(counterId);
  },

  async closeCounter(counterId: string): Promise<void> {
    if (apiImpl) return apiImpl.closeCounter(counterId);
    await closeCounterRemote(counterId);
  },

  async openCounter(
    counterId: string,
    _agentId: string,
    allowAlreadyOpen = false
  ): Promise<void> {
    if (apiImpl) return apiImpl.openCounter(counterId, _agentId);
    await openCounterRemote(counterId, allowAlreadyOpen);
  },

  // ---- Queues & Services ----

  async getBranchDisplay(branchId: string): Promise<BackendDisplay> {
    return fetchBranchDisplay(branchId);
  },

  async getQueues(branchId: string): Promise<Queue[]> {
    if (apiImpl) return apiImpl.getQueues(branchId);
    const display = await fetchBranchDisplay(branchId);
    return (display.services ?? []).map((service) => ({
      service_id: service.id,
      service_name: service.name,
      ticket_prefix: service.ticket_prefix,
      waiting_count: service.waiting ?? 0,
      called_count: service.last_called_number ? 1 : 0,
      last_called_number: service.last_called_number ?? undefined,
      estimated_wait_minutes: service.estimated_wait_minutes ?? undefined,
      tickets: [],
    }));
  },

  async getServices(branchId: string): Promise<Service[]> {
    if (apiImpl) return apiImpl.getServices(branchId);
    const data = await httpClient.get<BackendService[]>(
      `/branches/${branchId}/services`
    );
    return (data ?? []).map(mapService);
  },

  // ---- Employees (administration) ----

  async getEmployees(branchId: string): Promise<Employee[]> {
    if (apiImpl) return apiImpl.getEmployees(branchId);
    const context = requireApiContext();
    const data = await httpClient.get<Paginated<BackendEmployee>>(
      `/organizations/${context.orgId}/employees?agency_id=${encodeURIComponent(branchId)}&page_size=100`
    );
    return (data.items ?? []).map(mapEmployee);
  },

  async createEmployee(data: Partial<Employee>): Promise<Employee> {
    if (apiImpl) return apiImpl.createEmployee(data);
    throw new ApiError(
      "La création d'employé se fait depuis le back-office TONDE.",
      501,
      "NOT_SUPPORTED"
    );
  },

  async updateEmployee(id: string, data: Partial<Employee>): Promise<Employee> {
    if (apiImpl) return apiImpl.updateEmployee(id, data);
    throw new ApiError(
      "La modification d'employé se fait depuis le back-office TONDE.",
      501,
      "NOT_SUPPORTED"
    );
  },

  async deactivateEmployee(id: string): Promise<void> {
    if (apiImpl) return apiImpl.deactivateEmployee(id);
    throw new ApiError(
      "La désactivation d'employé se fait depuis le back-office TONDE.",
      501,
      "NOT_SUPPORTED"
    );
  },

  // ---- Stats ----

  async getAgentStats(agentId: string, date: string): Promise<AgentStats> {
    if (apiImpl) return apiImpl.getAgentStats(agentId, date);
    throw new ApiError(
      "Les statistiques agent ne sont pas exposées par ce backend.",
      501,
      "NOT_SUPPORTED"
    );
  },

  async getBranchStats(branchId: string, date: string): Promise<unknown> {
    if (apiImpl) return apiImpl.getBranchStats(branchId, date);
    throw new ApiError(
      "Les statistiques d'agence ne sont pas exposées par ce backend.",
      501,
      "NOT_SUPPORTED"
    );
  },
};

// ============================================================
// TONDE DESKTOP — Core Domain Types
// ============================================================

// ------ TICKET ------

export type TicketStatus =
  | "WAITING"
  | "CALLED"
  | "PROCESSING"
  | "INCOMPLETE"
  | "COMPLETED"
  | "ABSENT"
  | "CANCELLED";

export type TicketPriority = 0 | 1 | 2;

export interface Ticket {
  id: string;
  number: string;
  status: TicketStatus;
  priority: TicketPriority;
  requested_priority?: TicketPriority;
  created_at: string;
  called_at?: string;
  served_at?: string;
  closed_at?: string;
  service_id: string;
  branch_id: string;
  user_id?: string;
  wait_time_minutes?: number;
  processing_time_minutes?: number;

  // ------ Moteur d'absence et de reprise (spécification §5.1) ------
  // Valeurs SERVEUR. Le poste ne les recalcule jamais : il s'en sert pour
  // savoir QUAND agir (grâce), pas pour décider À LA PLACE du serveur.
  //
  // `grace_expires_at` : instant à partir duquel « Client absent » est autorisé.
  // Sans elle, le poste comparerait `called_at + 90 s` et se tromperait dès que
  // la valeur change côté serveur (une relance repousse cette échéance).
  grace_expires_at?: string;
  // `recovery_expires_at` : fin de la fenêtre de retour du client.
  recovery_expires_at?: string;
  // Nombre d'appels manqués déjà consommés (plafond : 2).
  missed_count?: number;
  // Ordre de passage monotone. Remplace le tri par `created_at`, qui ne
  // reproduisait pas exactement l'ordre du serveur à la milliseconde près.
  queue_sequence?: number;
  // Vrai quand le ticket existe en base mais n'a pas pu entrer dans la file
  // Redis : `position` vaut alors 0 et il ne faut pas l'afficher.
  queue_degraded?: boolean;

  // ── Identité du client (anti-fraude) ──────────────────────
  // Affichés au guichetier lors de l'appel pour vérifier que la personne
  // présente correspond à celle qui a pris le ticket.
  client_name?: string;
  client_phone?: string;
}

// ------ COUNTER (GUICHET) ------

export type CounterStatus = "OPEN" | "PAUSED" | "CLOSED";

export interface Counter {
  id: string;
  number: number;
  name: string;
  description?: string;
  status: CounterStatus;
  service_ids: string[];
  agent_id?: string;
  agent_name?: string;
  branch_id: string;
  is_active?: boolean;
  current_ticket?: Ticket;
  current_ticket_id?: string | null;
}

// ------ EMPLOYEE ------

export type EmployeeRole = "Agent" | "Supervisor" | "BranchAdmin" | "OrgAdmin";

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: EmployeeRole;
  is_active: boolean;
  branch_id: string;
  counter_id?: string;
  avatar_url?: string;
}

// ------ SERVICE ------

export interface Service {
  id: string;
  name: string;
  code: string;
  description?: string;
  branch_id: string;
  is_active: boolean;
  avg_processing_minutes?: number;
}

// ------ BRANCH (AGENCE) ------

export interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string;
  organization_id: string;
  timezone: string;
  is_active: boolean;
}

// ------ QUEUE ------

export interface Queue {
  service_id: string;
  service_name: string;
  ticket_prefix?: string;
  waiting_count: number;
  called_count: number;
  last_called_number?: string;
  estimated_wait_minutes?: number;
  tickets: Ticket[];
}

// ------ STATS AGENT ------

export interface AgentStats {
  agent_id: string;
  date: string;
  tickets_served: number;
  avg_processing_time_minutes: number;
  total_processing_time_minutes: number;
  absent_count: number;
  transferred_count: number;
}

// ------ WEBSOCKET EVENTS ------

export type WebSocketEventType =
  | "TICKET_CALLED"
  | "QUEUE_UPDATE"
  | "COUNTER_QUEUE_CHANGED"
  | "COUNTER_STATUS"
  | "TICKET_TRANSFERRED"
  | "AGENT_MESSAGE"
  | "SYNC_REQUIRED";

export interface WebSocketEvent<T = unknown> {
  type: WebSocketEventType;
  payload: T;
  branch_id: string;
  timestamp: string;
}

export interface TicketCalledPayload {
  ticket: Ticket;
  counter_id: string;
  agent_id: string;
}

export interface QueueUpdatePayload {
  service_id: string;
  waiting_count: number;
  tickets: Ticket[];
}

export interface CounterStatusPayload {
  counter: Counter;
}

export interface CounterQueueChangedPayload {
  agency_id: string;
  service_id: string;
  reason: string;
  ticket_number: string | null;
  status: string | null;
  counter_id: string | null;
  counter_name: string | null;
}

export interface AgentMessagePayload {
  from_supervisor_id: string;
  from_supervisor_name: string;
  message: string;
  counter_id: string;
}

// ------ OFFLINE SYNC ------

export type SyncActionType =
  | "CALL_TICKET"
  | "START_SERVING"
  | "RECALL_TICKET"
  | "MARK_ABSENT"
  | "MARK_INCOMPLETE"
  | "COMPLETE_TICKET"
  | "TRANSFER_TICKET"
  | "PAUSE_COUNTER"
  | "RESUME_COUNTER"
  | "OPEN_COUNTER"
  | "CLOSE_COUNTER";

export type SyncStatus = "PENDING" | "SYNCING" | "DONE" | "FAILED";

export interface SyncQueueItem {
  id: string;
  action: SyncActionType;
  payload: Record<string, unknown>;
  created_at: string;
  synced_at?: string;
  status: SyncStatus;
  retry_count: number;
  error?: string;
}

// ------ AUTH ------

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: EmployeeRole;
  branch_id: string;
  branch_name: string;
  counter_id?: string;
  token: string;
  refresh_token?: string;
  token_expires_at: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

// ------ UI STATE ------

export type ConnectionStatus = "CONNECTED" | "DISCONNECTED" | "RECONNECTING";

export interface Notification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  duration?: number;
  created_at: string;
}

export interface TransferDialogData {
  ticket: Ticket;
  available_counters: Counter[];
  available_services: Service[];
}

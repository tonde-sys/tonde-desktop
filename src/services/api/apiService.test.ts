import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL, API_PREFIX } from "../../config/api";
import {
  ApiError,
  apiService,
  getApiContext,
  httpClient,
  setApiContext,
} from "./apiService";

function mockResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function lastRequestInit(fetchMock: ReturnType<typeof vi.fn>, index = -1): RequestInit {
  const calls = fetchMock.mock.calls;
  const call = index < 0 ? calls[calls.length + index] : calls[index];
  return call[1] as RequestInit;
}

describe("httpClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    httpClient.clearToken();
    httpClient.setRefreshHandler(null);
    httpClient.setUnauthorizedHandler(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("déballe l'enveloppe { success, data }", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ success: true, data: { id: "ticket-1", status: "WAITING" }, message: null })
    );

    const ticket = await httpClient.get<{ id: string }>("/tickets/ticket-1");

    expect(ticket).toEqual({ id: "ticket-1", status: "WAITING" });
  });

  it("tolère une réponse brute sans enveloppe", async () => {
    fetchMock.mockResolvedValue(mockResponse({ id: "ticket-1" }));

    await expect(httpClient.get("/tickets/ticket-1")).resolves.toEqual({ id: "ticket-1" });
  });

  it("retourne telles quelles les réponses d'auth plates (sans data)", async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        success: true,
        access_token: "access-abc",
        refresh_token: "refresh-abc",
        token_type: "bearer",
        user: { id: "user-1", role: "agent" },
      })
    );

    const auth = await httpClient.post<{ access_token: string; user: { id: string } }>(
      "/auth/login",
      {}
    );

    expect(auth.access_token).toBe("access-abc");
    expect(auth.user.id).toBe("user-1");
  });

  it("rejette une erreur { success:false, error:{ code, message } }", async () => {
    fetchMock.mockResolvedValue(
      mockResponse(
        {
          success: false,
          error: { code: "QUEUE_EMPTY", message: "Aucun ticket en attente" },
        },
        409
      )
    );

    const error = await httpClient
      .post("/tickets/counter/call-next", {})
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).code).toBe("QUEUE_EMPTY");
    expect((error as ApiError).message).toBe("Aucun ticket en attente");
  });

  it("rejette une enveloppe success:false avec code et message", async () => {
    fetchMock.mockResolvedValue(
      mockResponse(
        {
          success: false,
          detail: { code: "TICKET_ALREADY_CALLED", message: "Ce ticket est déjà appelé" },
        },
        409
      )
    );

    const error = await httpClient.post("/tickets/ticket-1/call").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe("TICKET_ALREADY_CALLED");
    expect(apiError.message).toBe("Ce ticket est déjà appelé");
  });

  it("extrait le message d'erreur FastAPI { detail: string }", async () => {
    fetchMock.mockResolvedValue(mockResponse({ detail: "Guichet fermé" }, 400));

    await expect(httpClient.post("/counters/c1/call-next")).rejects.toMatchObject({
      status: 400,
      message: "Guichet fermé",
    });
  });

  it("transforme une panne réseau en ApiError NETWORK (status 0)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const error = await httpClient.get("/branches/b1/queues").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).code).toBe("NETWORK");
  });

  it("construit l'URL avec le préfixe REST et joint le token", async () => {
    fetchMock.mockResolvedValue(mockResponse({ success: true, data: [] }));
    httpClient.setToken("token-abc");

    await httpClient.get("/branches/b1/queues");

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}${API_PREFIX}/branches/b1/queues`,
      expect.objectContaining({ method: "GET" })
    );
    expect(lastRequestInit(fetchMock).headers).toMatchObject({
      Authorization: "Bearer token-abc",
    });
  });

  it("rafraîchit le token une seule fois sur 401 puis rejoue la requête", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ detail: "Token expiré" }, 401))
      .mockResolvedValueOnce(mockResponse({ success: true, data: { id: "ticket-1" } }));
    const refreshHandler = vi.fn().mockResolvedValue("new-token");
    httpClient.setRefreshHandler(refreshHandler);
    httpClient.setToken("old-token");

    const result = await httpClient.get<{ id: string }>("/tickets/ticket-1");

    expect(result).toEqual({ id: "ticket-1" });
    expect(refreshHandler).toHaveBeenCalledTimes(1);
    expect(lastRequestInit(fetchMock).headers).toMatchObject({
      Authorization: "Bearer new-token",
    });
  });

  it("ne renouvelle le token qu'une fois pour deux 401 simultanés", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ detail: "Token expiré" }, 401))
      .mockResolvedValueOnce(mockResponse({ detail: "Token expiré" }, 401))
      .mockResolvedValue(mockResponse({ success: true, data: { id: "ok" } }));
    const refreshHandler = vi.fn().mockResolvedValue("new-token");
    httpClient.setRefreshHandler(refreshHandler);
    httpClient.setToken("old-token");

    const [first, second] = await Promise.all([
      httpClient.get<{ id: string }>("/tickets/ticket-1"),
      httpClient.get<{ id: string }>("/branches/b1/queues"),
    ]);

    expect(first).toEqual({ id: "ok" });
    expect(second).toEqual({ id: "ok" });
    expect(refreshHandler).toHaveBeenCalledTimes(1);
  });

  it("ne tente jamais de refresh sur les routes /auth/*", async () => {
    fetchMock.mockResolvedValue(mockResponse({ detail: "Identifiants invalides" }, 401));
    const refreshHandler = vi.fn();
    httpClient.setRefreshHandler(refreshHandler);

    await expect(httpClient.post("/auth/login", {})).rejects.toMatchObject({
      status: 401,
      message: "Identifiants invalides",
    });
    expect(refreshHandler).not.toHaveBeenCalled();
  });

  it("déconnecte quand le refresh échoue", async () => {
    fetchMock.mockResolvedValue(mockResponse({ detail: "Token expiré" }, 401));
    const unauthorizedHandler = vi.fn();
    httpClient.setRefreshHandler(vi.fn().mockResolvedValue(null));
    httpClient.setUnauthorizedHandler(unauthorizedHandler);

    await expect(httpClient.get("/tickets/ticket-1")).rejects.toBeInstanceOf(ApiError);
    expect(unauthorizedHandler).toHaveBeenCalledTimes(1);
  });
});

describe("apiService — contexte staff & cycle de vie ticket", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setApiContext(null);
    httpClient.clearToken();
  });

  afterEach(() => {
    setApiContext(null);
    vi.unstubAllGlobals();
  });

  it("déduit automatiquement orgId, branchId et counter_id depuis user.memberships au login", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        success: true,
        access_token: "access-token",
        refresh_token: "refresh-token",
        user: {
          id: "u-agent-1",
          name: "Agent Guichet",
          email: "agent@banque.bi",
          role: "agent",
          language: "fr",
          is_verified: true,
          org_id: "org-123",
          memberships: [
            {
              employee_id: "emp-1",
              org_id: "org-123",
              branch_id: "branch-456",
              counter_id: "counter-789",
              role: "agent",
              status: "active",
            },
          ],
        },
      })
    );

    const user = await apiService.login({
      email: "agent@banque.bi",
      password: "secret",
    });

    expect(getApiContext()).toEqual({
      orgId: "org-123",
      branchId: "branch-456",
    });
    expect(user.branch_id).toBe("branch-456");
    expect(user.counter_id).toBe("counter-789");
  });

  it("mappe séparément called_at, served_at et closed_at depuis GET /tickets/{id}", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        success: true,
        data: {
          id: "t-1",
          number: "A-042",
          status: "serving",
          priority: "priority",
          requested_priority: "vip",
          agency_id: "branch-456",
          service_id: "svc-1",
          created_at: "2026-11-15T08:00:00Z",
          called_at: "2026-11-15T08:05:00Z",
          served_at: "2026-11-15T08:06:15Z",
          done_at: null,
          counter_name: "Guichet 1",
        },
      })
    );

    const ticket = await apiService.getTicket("t-1");

    expect(ticket).toMatchObject({
      id: "t-1",
      number: "A-042",
      status: "PROCESSING",
      priority: 1,
      requested_priority: 2,
      called_at: "2026-11-15T08:05:00Z",
      served_at: "2026-11-15T08:06:15Z",
      closed_at: undefined,
    });
  });

  it("startServingTicket appelle POST /tickets/{id}/serving et tolère INVALID_TRANSITION en rejeu", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ success: true, ticket_id: "t-1" }))
      .mockResolvedValueOnce(
        mockResponse(
          {
            detail: {
              code: "INVALID_TRANSITION",
              message: "Déjà en service",
            },
          },
          400
        )
      );

    await expect(
      apiService.startServingTicket("t-1", "counter-1")
    ).resolves.toBeUndefined();
    await expect(
      apiService.startServingTicket("t-1", "counter-1")
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

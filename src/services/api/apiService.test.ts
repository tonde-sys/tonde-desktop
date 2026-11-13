import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL, API_PREFIX } from "../../config/api";
import { ApiError, httpClient } from "./apiService";

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

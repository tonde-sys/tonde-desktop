import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser, LoginCredentials } from "../types";
import { ApiError } from "../services/api/apiService";

vi.mock("../services/database/db", () => ({
  db: { upsertEmployee: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../services/secure/tokenStorage", () => ({
  tokenStorage: {
    setBundle: vi.fn().mockResolvedValue(undefined),
    getBundle: vi.fn().mockResolvedValue(null),
  },
  isTauriRuntime: () => false,
}));

vi.mock("../services/api/apiService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/api/apiService")>();
  return {
    ...actual,
    apiService: { ...actual.apiService, login: vi.fn() },
  };
});

import { apiService } from "../services/api/apiService";
import { useAuthStore } from "./authStore";

const credentials: LoginCredentials = {
  email: "agent1@ulbu.bi",
  password: "secret",
};

const user: AuthUser = {
  id: "user-1",
  name: "Agent 1",
  email: credentials.email,
  role: "Agent",
  branch_id: "branch-1",
  branch_name: "Agence 1",
  token: "access-abc",
  refresh_token: "refresh-abc",
  token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
};

const loginMock = vi.mocked(apiService.login);

describe("authStore.login — cold start Render", () => {
  beforeEach(() => {
    loginMock.mockReset();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isWaking: false,
      isInitializing: false,
      isInitialized: false,
      error: null,
      errorKind: null,
    });
  });

  it("réessaie après une coupure réseau puis réussit", async () => {
    vi.useFakeTimers();
    loginMock
      .mockRejectedValueOnce(new ApiError("coupure", 0, "NETWORK"))
      .mockResolvedValueOnce(user);

    const pending = useAuthStore.getState().login(credentials);
    await vi.runAllTimersAsync();
    await pending;

    expect(loginMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().isWaking).toBe(false);
    vi.useRealTimers();
  });

  it("ne réessaie pas des identifiants invalides", async () => {
    loginMock.mockRejectedValueOnce(
      new ApiError("bad", 401, "INVALID_CREDENTIALS")
    );

    await useAuthStore.getState().login(credentials);

    expect(loginMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().error).toBe(
      "Email ou mot de passe incorrect."
    );
    expect(useAuthStore.getState().errorKind).toBe("credentials");
  });

  it("abandonne après trois réessais et affiche l'erreur réseau", async () => {
    vi.useFakeTimers();
    loginMock.mockRejectedValue(new ApiError("down", 0, "NETWORK"));

    const pending = useAuthStore.getState().login(credentials);
    await vi.runAllTimersAsync();
    await pending;

    expect(loginMock).toHaveBeenCalledTimes(4);
    expect(useAuthStore.getState().error).toContain("injoignable");
    expect(useAuthStore.getState().errorKind).toBe("network");
    expect(useAuthStore.getState().isLoading).toBe(false);
    vi.useRealTimers();
  });

  it("affiche un message dédié quand le poste est hors ligne", async () => {
    const onLine = vi
      .spyOn(navigator, "onLine", "get")
      .mockReturnValue(false);
    vi.useFakeTimers();
    loginMock.mockRejectedValue(new ApiError("down", 0, "NETWORK"));

    const pending = useAuthStore.getState().login(credentials);
    await vi.runAllTimersAsync();
    await pending;

    expect(useAuthStore.getState().errorKind).toBe("offline");
    expect(useAuthStore.getState().error).toContain("connexion Internet");

    onLine.mockRestore();
    vi.useRealTimers();
  });

  it("reprend le login automatiquement au retour du réseau", async () => {
    vi.useFakeTimers();
    loginMock.mockRejectedValue(new ApiError("coupure", 0, "NETWORK"));

    const pending = useAuthStore.getState().login(credentials);
    await vi.runAllTimersAsync();
    await pending;

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().errorKind).toBe("network");

    // Le réseau revient : nouvel essai avec les identifiants en mémoire.
    loginMock.mockResolvedValueOnce(user);
    await useAuthStore.getState().retryPendingLogin();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().errorKind).toBeNull();

    // Identifiants oubliés après succès : plus aucune reprise.
    const callsAfterSuccess = loginMock.mock.calls.length;
    await useAuthStore.getState().retryPendingLogin();
    expect(loginMock.mock.calls.length).toBe(callsAfterSuccess);
    vi.useRealTimers();
  });
});

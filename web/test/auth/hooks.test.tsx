/**
 * Auth hook tests (R3.13, O-230). useMe and useLogin run against an injected fake fetch inside a
 * fresh QueryClient, so the fetch count proves the no-retry rule for 4xx answers and the token
 * holder proves login and /me keep the CSRF (cross-site request forgery) token in memory.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ApiProblem, createAppApi } from "../../src/api/index.js";
import type { AppApi } from "../../src/api/index.js";
import {
  ApiProvider,
  createQueryClient,
  fetchMe,
  ME_QUERY_KEY,
  shouldRetryQuery,
  useAppApi,
  useLogin,
  useMe,
} from "../../src/auth/index.js";
import { fixtureSession } from "../../src/fixtures/index.js";
import { createFakeFetch, problemResponse, sessionResponse } from "../api/fake-fetch.js";
import type { FetchScript } from "../api/fake-fetch.js";

const ORIGIN = "http://localhost:4173";

function setup(script: FetchScript) {
  const fake = createFakeFetch(script);
  const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });
  const queryClient = createQueryClient();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={api}>{children}</ApiProvider>
      </QueryClientProvider>
    );
  }
  return { fake, api, queryClient, wrapper };
}

function cachedMe(queryClient: QueryClient) {
  return queryClient.getQueryData(ME_QUERY_KEY);
}

describe("useMe", () => {
  it("R3.13 returns the session and keeps its csrf token in memory", async () => {
    const { api, wrapper } = setup({ "GET /api/v1/me": [sessionResponse("me-token")] });
    const { result } = renderHook(() => useMe(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.user.email).toBe(fixtureSession.user.email);
    expect(api.tokens.get()).toBe("me-token");
  });

  it("R3.13 a 401 means signed out: data is null, not an error", async () => {
    const { api, wrapper } = setup({ "GET /api/v1/me": [problemResponse(401, "unauthenticated")] });
    api.tokens.set("old-token");
    const { result } = renderHook(() => useMe(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(api.tokens.get()).toBeNull();
  });

  it("R3.13 another 4xx is an ApiProblem error and is not retried", async () => {
    const { fake, wrapper } = setup({ "GET /api/v1/me": [problemResponse(429, "rate-limited")] });
    const { result } = renderHook(() => useMe(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiProblem);
    expect((result.current.error as ApiProblem).slug).toBe("rate-limited");
    expect(fake.calls).toHaveLength(1);
  });
});

describe("fetchMe", () => {
  it("R3.13 throws an ApiProblem for a server error", async () => {
    const { api } = setup({ "GET /api/v1/me": [problemResponse(500, "internal")] });
    await expect(fetchMe(api)).rejects.toMatchObject({ status: 500, slug: "internal" });
  });
});

describe("useLogin", () => {
  it("R3.13 stores the csrf token and sets the me query data", async () => {
    const { api, fake, queryClient, wrapper } = setup({ "POST /api/v1/auth/login": [sessionResponse("login-token")] });
    const { result } = renderHook(() => useLogin(), { wrapper });
    await act(() => result.current.mutateAsync({ email: "owner@example.com", password: "correct horse" }));
    expect(api.tokens.get()).toBe("login-token");
    expect(cachedMe(queryClient)).toMatchObject({ csrf_token: "login-token" });
    expect(JSON.parse(fake.calls[0]?.body ?? "{}")).toEqual({ email: "owner@example.com", password: "correct horse" });
  });

  it("R3.13 a 401 rejects with an ApiProblem and stores nothing", async () => {
    const { api, queryClient, wrapper } = setup({ "POST /api/v1/auth/login": [problemResponse(401, "unauthenticated")] });
    const { result } = renderHook(() => useLogin(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ email: "a@example.com", password: "x" })).rejects.toBeInstanceOf(ApiProblem);
    });
    expect(api.tokens.get()).toBeNull();
    // The 401 marks the session signed out (null); it never stores a session.
    expect(cachedMe(queryClient) ?? null).toBeNull();
  });
});

describe("createQueryClient", () => {
  it("R3.13 never retries a 4xx problem and retries other failures a bounded number of times", () => {
    expect(shouldRetryQuery(0, new ApiProblem({ status: 404, slug: "not-found", title: "t" }))).toBe(false);
    expect(shouldRetryQuery(0, new ApiProblem({ status: 503, slug: "unavailable", title: "t" }))).toBe(true);
    expect(shouldRetryQuery(0, new TypeError("network"))).toBe(true);
    expect(shouldRetryQuery(5, new TypeError("network"))).toBe(false);
  });

  it("R3.13 a 401 from any query marks the session signed out", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, fixtureSession);
    await queryClient
      .fetchQuery({
        queryKey: ["other"],
        queryFn: () => Promise.reject(new ApiProblem({ status: 401, slug: "unauthenticated", title: "t" })),
      })
      .catch(() => undefined);
    expect(cachedMe(queryClient)).toBeNull();
  });

  it("R3.13 a 401 from a mutation marks the session signed out", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(ME_QUERY_KEY, fixtureSession);
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => Promise.reject(new ApiProblem({ status: 401, slug: "unauthenticated", title: "t" })),
    });
    await mutation.execute(undefined).catch(() => undefined);
    expect(cachedMe(queryClient)).toBeNull();
  });
});

describe("useAppApi", () => {
  it("R3.13 falls back to the app singleton outside a provider", () => {
    const { result } = renderHook(() => useAppApi());
    const api: AppApi = result.current;
    expect(api.tokens).toBeDefined();
  });
});

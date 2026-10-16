import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSnapshot } from "../shared/api";
import {
  fetchWorkspace,
  WORKSPACE_POLL_INTERVAL_MS,
  WORKSPACE_QUERY_OPTIONS,
  WorkspaceRequestError,
} from "./workspace-query";

const snapshot: WorkspaceSnapshot = {
  lawyers: [],
  documents: [],
  monthlyAllowance: {
    month: "2026-10",
    limit: 10,
    completed: 0,
    reserved: 0,
    available: 10,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace query", () => {
  it("fetches the workspace without HTTP caching and preserves the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWorkspace()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/workspace", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("uses the safe API error message for a failed request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "WORKSPACE_UNAVAILABLE",
              message: "Workspace data is unavailable.",
            },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(fetchWorkspace()).rejects.toEqual(
      new WorkspaceRequestError("Workspace data is unavailable."),
    );
  });

  it("falls back safely when an error response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("internal detail", { status: 500 })),
    );

    await expect(fetchWorkspace()).rejects.toEqual(
      new WorkspaceRequestError("The workspace could not be loaded."),
    );
  });

  it("retains the last snapshot after a polling error and recovers later", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(WORKSPACE_QUERY_OPTIONS.queryKey, snapshot);

    await expect(
      queryClient.fetchQuery({ ...WORKSPACE_QUERY_OPTIONS, retry: false }),
    ).rejects.toBeInstanceOf(WorkspaceRequestError);
    expect(queryClient.getQueryData(WORKSPACE_QUERY_OPTIONS.queryKey)).toEqual(
      snapshot,
    );
    expect(
      queryClient.getQueryState(WORKSPACE_QUERY_OPTIONS.queryKey)?.status,
    ).toBe("error");

    await expect(
      queryClient.fetchQuery({ ...WORKSPACE_QUERY_OPTIONS, retry: false }),
    ).resolves.toEqual(snapshot);
    expect(
      queryClient.getQueryState(WORKSPACE_QUERY_OPTIONS.queryKey)?.status,
    ).toBe("success");
  });

  it("polls every five seconds only in the foreground and refetches on focus", () => {
    expect(WORKSPACE_POLL_INTERVAL_MS).toBe(5_000);
    expect(WORKSPACE_QUERY_OPTIONS).toMatchObject({
      refetchInterval: 5_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      staleTime: 0,
    });
  });
});

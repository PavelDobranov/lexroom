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

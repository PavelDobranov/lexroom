import type { ApiError, WorkspaceSnapshot } from "../../shared/api";

export const WORKSPACE_QUERY_KEY = ["workspace"] as const;
export const WORKSPACE_POLL_INTERVAL_MS = 5_000;

export class WorkspaceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRequestError";
  }
}

export async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  const response = await fetch("/api/workspace", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    let message = "The workspace could not be loaded.";

    try {
      const body = (await response.json()) as ApiError;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Keep the safe fallback when the server does not return JSON.
    }

    throw new WorkspaceRequestError(message);
  }

  return (await response.json()) as WorkspaceSnapshot;
}

export const WORKSPACE_QUERY_OPTIONS = {
  queryKey: WORKSPACE_QUERY_KEY,
  queryFn: fetchWorkspace,
  refetchInterval: WORKSPACE_POLL_INTERVAL_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 0,
  retry: 1,
} as const;

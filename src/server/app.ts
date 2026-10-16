import type Database from "better-sqlite3";
import { Hono } from "hono";
import type { Context } from "hono";

import type { ApiError, CreateReviewRequest } from "../shared/api";
import { openDatabase, resolveDatabasePath } from "./db/database";
import { ReviewService, readReviewSnapshot } from "./reviews/review-service";
import { launchReview as defaultLaunchReview } from "./reviews/runtime";
import { readWorkspaceSnapshot } from "./workspace/read-workspace";

type ApiDependencies = {
  openWorkspaceDatabase: () => Database.Database;
  now: () => Date;
  logger: Pick<Console, "error">;
  launchReview: (input: { reviewId: string; documentId: string }) => void;
};

const defaultDependencies: ApiDependencies = {
  openWorkspaceDatabase: () => openDatabase(resolveDatabasePath()),
  now: () => new Date(),
  logger: console,
  launchReview: defaultLaunchReview,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorBody(code: string, message: string): ApiError {
  return { error: { code, message } };
}

function isTemporaryDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code ?? "";
  return code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED");
}

// Review endpoints return safe messages and keep technical detail server-side.
function respondServiceError(
  c: Context,
  logger: Pick<Console, "error">,
  error: unknown,
  logMessage: string,
) {
  if (isTemporaryDatabaseError(error)) {
    return c.json(
      errorBody(
        "REVIEW_SERVICE_UNAVAILABLE",
        "The review service is temporarily unavailable. Please try again.",
      ),
      503,
    );
  }
  logger.error(logMessage, error);
  return c.json(
    errorBody("INTERNAL_ERROR", "Something went wrong. Please try again."),
    500,
  );
}

const DENIAL_RESPONSES: Record<
  string,
  { status: 404 | 409; code: string; message: string }
> = {
  request_id_conflict: {
    status: 409,
    code: "REQUEST_ID_CONFLICT",
    message: "This request ID is already used for a different review.",
  },
  document_not_found: {
    status: 404,
    code: "DOCUMENT_NOT_FOUND",
    message: "The document was not found.",
  },
  lawyer_not_found: {
    status: 404,
    code: "LAWYER_NOT_FOUND",
    message: "The selected lawyer was not found.",
  },
  review_already_running: {
    status: 409,
    code: "REVIEW_ALREADY_RUNNING",
    message: "A review is already running for this document.",
  },
  allowance_exhausted: {
    status: 409,
    code: "ALLOWANCE_EXHAUSTED",
    message: "The monthly review allowance is exhausted for this month.",
  },
  allowance_temporarily_reserved: {
    status: 409,
    code: "ALLOWANCE_TEMPORARILY_RESERVED",
    message: "The monthly review allowance is fully reserved right now.",
  },
};

export function createApi(
  dependencies: ApiDependencies = defaultDependencies,
): Hono {
  const app = new Hono().basePath("/api");

  app.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  app.get("/workspace", (c) => {
    c.header("Cache-Control", "no-store");

    let sqlite: Database.Database | undefined;
    try {
      sqlite = dependencies.openWorkspaceDatabase();
      return c.json(readWorkspaceSnapshot(sqlite, dependencies.now()));
    } catch (error) {
      dependencies.logger.error("Failed to read the workspace snapshot", error);
      return c.json(
        errorBody("WORKSPACE_UNAVAILABLE", "Workspace data is unavailable."),
        500,
      );
    } finally {
      sqlite?.close();
    }
  });

  app.get("/reviews/:reviewId", (c) => {
    c.header("Cache-Control", "no-store");

    let sqlite: Database.Database | undefined;
    try {
      sqlite = dependencies.openWorkspaceDatabase();
      const snapshot = readReviewSnapshot(sqlite, c.req.param("reviewId"));
      if (!snapshot) {
        return c.json(
          errorBody("REVIEW_NOT_FOUND", "The review was not found."),
          404,
        );
      }
      return c.json(snapshot);
    } catch (error) {
      return respondServiceError(
        c,
        dependencies.logger,
        error,
        "Failed to read the review snapshot",
      );
    } finally {
      sqlite?.close();
    }
  });

  app.post("/documents/:documentId/reviews", async (c) => {
    c.header("Cache-Control", "no-store");

    const documentId = c.req.param("documentId");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        errorBody("INVALID_REQUEST", "The review request is invalid."),
        400,
      );
    }

    const candidate = body as Partial<CreateReviewRequest> | null;
    const requestedByLawyerId = candidate?.requestedByLawyerId;
    const requestId = candidate?.requestId;
    if (
      typeof requestedByLawyerId !== "string" ||
      requestedByLawyerId.trim().length === 0 ||
      typeof requestId !== "string" ||
      !UUID_PATTERN.test(requestId)
    ) {
      return c.json(
        errorBody("INVALID_REQUEST", "The review request is invalid."),
        400,
      );
    }

    let result;
    try {
      const sqlite = dependencies.openWorkspaceDatabase();
      try {
        result = new ReviewService(sqlite, dependencies.now).admit({
          documentId,
          requestedByLawyerId,
          requestId,
        });
      } finally {
        sqlite.close();
      }
    } catch (error) {
      return respondServiceError(
        c,
        dependencies.logger,
        error,
        "Failed to admit the review",
      );
    }

    if (result.outcome === "created") {
      // Only a newly created review launches execution, and only once.
      dependencies.launchReview({
        reviewId: result.review.id,
        documentId,
      });
      c.header("Location", `/api/reviews/${result.review.id}`);
      return c.json(result.review, 201);
    }
    if (result.outcome === "replayed") {
      return c.json(result.review, 200);
    }

    const denial = DENIAL_RESPONSES[result.outcome];
    return c.json(errorBody(denial.code, denial.message), denial.status);
  });

  return app;
}

export const api = createApi();

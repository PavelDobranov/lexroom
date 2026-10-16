import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import documentFixtures from "../../samples/documents.json";
import lawyerFixtures from "../../samples/lawyers.json";
import type { ReviewSnapshot, WorkspaceSnapshot } from "../shared/api";
import { createApi } from "./app";
import { openDatabase } from "./db/database";
import { setupDatabase } from "./db/setup";
import { ReviewService } from "./reviews/review-service";

let temporaryDirectory: string;
let databasePath: string;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), "lexroom-api-"));
  databasePath = path.join(temporaryDirectory, "workspace.sqlite");
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function apiFor(
  now: Date,
  overrides: {
    logger?: Pick<Console, "error">;
    launchReview?: (input: { reviewId: string; documentId: string }) => void;
    openWorkspaceDatabase?: () => ReturnType<typeof openDatabase>;
  } = {},
) {
  return createApi({
    openWorkspaceDatabase:
      overrides.openWorkspaceDatabase ?? (() => openDatabase(databasePath)),
    now: () => now,
    logger: overrides.logger ?? { error: vi.fn() },
    launchReview: overrides.launchReview ?? vi.fn(),
  });
}

describe("GET /api/workspace", () => {
  it("returns the complete ordered public snapshot without review data or findings", async () => {
    setupDatabase(databasePath);
    const response = await apiFor(
      new Date("2026-10-31T23:59:59.999Z"),
    ).request("/api/workspace");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const snapshot = (await response.json()) as WorkspaceSnapshot;
    expect(snapshot).toEqual({
      lawyers: [...lawyerFixtures].sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      ),
      documents: documentFixtures
        .map((document) => ({
          id: document.id,
          title: document.title,
          type: document.type,
          pages: document.pages,
          uploadedAt: document.uploadedAt,
          uploadedByLawyerId: document.uploadedBy,
          supersedesDocumentId: document.supersedes,
          latestReviewAttempt: null,
          latestSuccessfulReview: null,
        }))
        .sort((left, right) =>
          left.uploadedAt === right.uploadedAt
            ? left.id.localeCompare(right.id)
            : right.uploadedAt.localeCompare(left.uploadedAt),
        ),
      monthlyAllowance: {
        month: "2026-10",
        limit: 10,
        completed: 0,
        reserved: 0,
        available: 10,
      },
    });

    const serializedSnapshot = JSON.stringify(snapshot);
    expect(serializedSnapshot).not.toContain("findings");
    for (const document of documentFixtures) {
      for (const finding of document.findings) {
        for (const privateValue of [
          finding.title,
          finding.excerpt,
          finding.explanation,
        ]) {
          if (privateValue !== null) {
            expect(serializedSnapshot).not.toContain(privateValue);
          }
        }
      }
    }
  });

  it("orders nonalphabetical lawyers and mixed-precision timestamps", async () => {
    setupDatabase(databasePath);
    const sqlite = openDatabase(databasePath);
    try {
      sqlite.exec(`
        insert into lawyers (id, name, title) values
          ('z-lawyer', 'Zulu Counsel', 'Counsel'),
          ('a-lawyer', 'Aaron Counsel', 'Counsel');

        insert into documents (
          id, title, type, pages, uploaded_at, uploaded_by_lawyer_id
        ) values
          ('fraction-old', 'Whole second', 'other', 1,
           '2030-01-01T00:00:00Z', 'a-lawyer'),
          ('fraction-new', 'Fractional second', 'other', 1,
           '2030-01-01T00:00:00.1Z', 'a-lawyer');
      `);
    } finally {
      sqlite.close();
    }

    const response = await apiFor(new Date("2030-01-01T00:00:00Z")).request(
      "/api/workspace",
    );
    const snapshot = (await response.json()) as WorkspaceSnapshot;

    expect(snapshot.lawyers.map(({ name }) => name)).toEqual([
      "Aaron Counsel",
      "Chiara Belotti",
      "Riccardo Fanti",
      "Sofia Greco",
      "Zulu Counsel",
    ]);
    expect(snapshot.documents.slice(0, 2).map(({ id }) => id)).toEqual([
      "fraction-new",
      "fraction-old",
    ]);
  });

  it("derives the allowance month from UTC across a month boundary", async () => {
    setupDatabase(databasePath);

    const october = (await (
      await apiFor(new Date("2026-10-31T23:59:59.999Z")).request(
        "/api/workspace",
      )
    ).json()) as WorkspaceSnapshot;
    const november = (await (
      await apiFor(new Date("2026-11-01T00:00:00.000Z")).request(
        "/api/workspace",
      )
    ).json()) as WorkspaceSnapshot;

    expect(october.monthlyAllowance.month).toBe("2026-10");
    expect(november.monthlyAllowance.month).toBe("2026-11");
  });

  it("returns a safe error and logs details without creating missing storage", async () => {
    const logger = { error: vi.fn() };

    const response = await apiFor(new Date(), { logger }).request("/api/workspace");

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "WORKSPACE_UNAVAILABLE",
        message: "Workspace data is unavailable.",
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to read the workspace snapshot",
      expect.any(Error),
    );
    expect(existsSync(databasePath)).toBe(false);
  });

  it("does not migrate or seed an existing uninitialized database", async () => {
    writeFileSync(databasePath, "");
    const logger = { error: vi.fn() };

    const response = await apiFor(new Date(), { logger }).request("/api/workspace");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "WORKSPACE_UNAVAILABLE",
        message: "Workspace data is unavailable.",
      },
    });

    const sqlite = openDatabase(databasePath);
    try {
      expect(
        sqlite
          .prepare<[], { name: string }>(`
            select name from sqlite_schema
            where type = 'table' and name not like 'sqlite_%'
          `)
          .all(),
      ).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});

describe("GET /api/health", () => {
  it("remains available without workspace storage", async () => {
    const response = await apiFor(new Date()).request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(existsSync(databasePath)).toBe(false);
  });
});

const REVIEW_NOW = new Date("2026-10-16T12:00:00.000Z");
const documentId = documentFixtures[0].id;
const otherDocumentId = documentFixtures[1].id;
const lawyerId = lawyerFixtures[0].id;

function post(
  api: ReturnType<typeof apiFor>,
  docId: string,
  body: unknown,
) {
  return api.request(`/api/documents/${docId}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function withConnection<T>(fn: (sqlite: ReturnType<typeof openDatabase>) => T): T {
  const sqlite = openDatabase(databasePath);
  try {
    return fn(sqlite);
  } finally {
    sqlite.close();
  }
}

function admitDirect(docId = documentId): string {
  return withConnection((sqlite) => {
    const result = new ReviewService(sqlite, () => REVIEW_NOW).admit({
      documentId: docId,
      requestedByLawyerId: lawyerId,
      requestId: crypto.randomUUID(),
    });
    if (result.outcome !== "created") throw new Error(result.outcome);
    return result.review.id;
  });
}

function seedCompleted(count: number): void {
  withConnection((sqlite) => {
    for (let i = 0; i < count; i += 1) {
      sqlite
        .prepare(`
          insert into reviews (
            id, document_id, requested_by_lawyer_id, request_id, status,
            allowance_month, requested_at, deadline_at, completed_at
          ) values (?, ?, ?, ?, 'completed', '2026-10', '2026-10-15T10:00:00.000Z', '2026-10-15T10:01:00.000Z', '2026-10-15T10:00:30.000Z')
        `)
        .run(
          `seed-${i}`,
          documentFixtures[i].id,
          lawyerId,
          `seed-req-${i}`,
        );
    }
  });
}

describe("POST /api/documents/:documentId/reviews", () => {
  beforeEach(() => setupDatabase(databasePath));

  it("creates a running review, returns 201 with Location, and launches once", async () => {
    const launchReview = vi.fn();
    const api = apiFor(REVIEW_NOW, { launchReview });
    const requestId = crypto.randomUUID();

    const response = await post(api, documentId, {
      requestedByLawyerId: lawyerId,
      requestId,
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const review = (await response.json()) as ReviewSnapshot;
    expect(response.headers.get("Location")).toBe(`/api/reviews/${review.id}`);
    expect(review.status).toBe("running");
    expect(review.allowanceMonth).toBe("2026-10");
    expect(launchReview).toHaveBeenCalledTimes(1);
    expect(launchReview).toHaveBeenCalledWith({ reviewId: review.id, documentId });
  });

  it("replays a matching request ID with 200 and no second launch", async () => {
    const launchReview = vi.fn();
    const api = apiFor(REVIEW_NOW, { launchReview });
    const body = { requestedByLawyerId: lawyerId, requestId: crypto.randomUUID() };

    const created = await post(api, documentId, body);
    const replay = await post(api, documentId, body);

    expect(created.status).toBe(201);
    expect(replay.status).toBe(200);
    expect((await created.json()).id).toBe((await replay.json()).id);
    expect(launchReview).toHaveBeenCalledTimes(1);
  });

  it("returns 409 REQUEST_ID_CONFLICT for a reused ID with a different document", async () => {
    const api = apiFor(REVIEW_NOW);
    const requestId = crypto.randomUUID();
    await post(api, documentId, { requestedByLawyerId: lawyerId, requestId });

    const conflict = await post(api, otherDocumentId, {
      requestedByLawyerId: lawyerId,
      requestId,
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("REQUEST_ID_CONFLICT");
  });

  it("rejects invalid bodies with 400 INVALID_REQUEST", async () => {
    const api = apiFor(REVIEW_NOW);
    const cases: unknown[] = [
      "{ not json",
      { requestedByLawyerId: lawyerId, requestId: "not-a-uuid" },
      { requestedByLawyerId: "", requestId: crypto.randomUUID() },
      { requestId: crypto.randomUUID() },
    ];
    for (const body of cases) {
      const response = await post(api, documentId, body);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    }
  });

  it("returns 404 for missing document and lawyer references", async () => {
    const api = apiFor(REVIEW_NOW);
    const missingDocument = await post(api, "missing-document", {
      requestedByLawyerId: lawyerId,
      requestId: crypto.randomUUID(),
    });
    expect(missingDocument.status).toBe(404);
    expect((await missingDocument.json()).error.code).toBe("DOCUMENT_NOT_FOUND");

    const missingLawyer = await post(api, documentId, {
      requestedByLawyerId: "missing-lawyer",
      requestId: crypto.randomUUID(),
    });
    expect(missingLawyer.status).toBe(404);
    expect((await missingLawyer.json()).error.code).toBe("LAWYER_NOT_FOUND");
  });

  it("returns 409 REVIEW_ALREADY_RUNNING for a second start", async () => {
    admitDirect(documentId);
    const response = await post(apiFor(REVIEW_NOW), documentId, {
      requestedByLawyerId: lawyerId,
      requestId: crypto.randomUUID(),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("REVIEW_ALREADY_RUNNING");
  });

  it("distinguishes exhausted and temporarily reserved allowance", async () => {
    seedCompleted(10);
    const exhausted = await post(apiFor(REVIEW_NOW), documentFixtures[11].id, {
      requestedByLawyerId: lawyerId,
      requestId: crypto.randomUUID(),
    });
    expect(exhausted.status).toBe(409);
    expect((await exhausted.json()).error.code).toBe("ALLOWANCE_EXHAUSTED");

    // 9 completed + 1 running = fully reserved, not exhausted.
    withConnection((sqlite) => sqlite.exec("delete from reviews"));
    seedCompleted(9);
    admitDirect(documentFixtures[9].id);
    const reserved = await post(apiFor(REVIEW_NOW), documentFixtures[11].id, {
      requestedByLawyerId: lawyerId,
      requestId: crypto.randomUUID(),
    });
    expect(reserved.status).toBe(409);
    expect((await reserved.json()).error.code).toBe(
      "ALLOWANCE_TEMPORARILY_RESERVED",
    );
  });
});

describe("GET /api/reviews/:reviewId", () => {
  beforeEach(() => setupDatabase(databasePath));

  it("returns a running snapshot with partialFindings and no-store", async () => {
    const reviewId = admitDirect();
    const response = await apiFor(REVIEW_NOW).request(`/api/reviews/${reviewId}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const snapshot = (await response.json()) as ReviewSnapshot;
    expect(snapshot.status).toBe("running");
    expect("partialFindings" in snapshot).toBe(true);
    expect("findings" in snapshot).toBe(false);
  });

  it("returns a completed snapshot with findings only", async () => {
    const reviewId = admitDirect();
    withConnection((sqlite) => {
      const service = new ReviewService(sqlite, () => REVIEW_NOW);
      service.emitFinding(reviewId, {
        position: 0,
        clause: "1.0",
        title: "Clause",
        severity: "high",
        excerpt: null,
        explanation: "Detail",
      });
      service.complete(reviewId);
    });

    const snapshot = (await (
      await apiFor(REVIEW_NOW).request(`/api/reviews/${reviewId}`)
    ).json()) as ReviewSnapshot;
    expect(snapshot.status).toBe("completed");
    expect("findings" in snapshot).toBe(true);
    expect("partialFindings" in snapshot).toBe(false);
  });

  it("serializes a failed snapshot without any finding property", async () => {
    const reviewId = admitDirect();
    withConnection((sqlite) =>
      new ReviewService(sqlite, () => REVIEW_NOW).fail(reviewId, "ai_error"),
    );

    const snapshot = (await (
      await apiFor(REVIEW_NOW).request(`/api/reviews/${reviewId}`)
    ).json()) as ReviewSnapshot;
    expect(snapshot.status).toBe("failed");
    expect("findings" in snapshot).toBe(false);
    expect("partialFindings" in snapshot).toBe(false);
  });

  it("returns 404 REVIEW_NOT_FOUND for an unknown review", async () => {
    const response = await apiFor(REVIEW_NOW).request(
      "/api/reviews/does-not-exist",
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("REVIEW_NOT_FOUND");
  });
});

describe("review endpoint infrastructure failures", () => {
  it("maps temporary SQLite unavailability to a safe 503", async () => {
    const api = apiFor(REVIEW_NOW, {
      openWorkspaceDatabase: () => {
        const error = new Error("database is locked");
        (error as { code?: string }).code = "SQLITE_BUSY";
        throw error;
      },
    });

    const response = await api.request("/api/reviews/any");
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("REVIEW_SERVICE_UNAVAILABLE");
  });

  it("maps unexpected failures to a safe 500 and logs server-side", async () => {
    const logger = { error: vi.fn() };
    const api = apiFor(REVIEW_NOW, {
      logger,
      openWorkspaceDatabase: () => {
        throw new Error("boom");
      },
    });

    const response = await api.request("/api/reviews/any");
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("GET /api/workspace review summaries", () => {
  beforeEach(() => setupDatabase(databasePath));

  it("widens documents with latest attempt and successful review summaries and no finding bodies", async () => {
    // A completed review on one document, a running review on another.
    const completedId = admitDirect(documentId);
    withConnection((sqlite) => {
      const service = new ReviewService(sqlite, () => REVIEW_NOW);
      service.emitFinding(completedId, {
        position: 0,
        clause: null,
        title: "Private finding title",
        severity: "low",
        excerpt: "Private excerpt",
        explanation: "Private explanation",
      });
      service.complete(completedId);
    });
    admitDirect(otherDocumentId);

    const snapshot = (await (
      await apiFor(REVIEW_NOW).request("/api/workspace")
    ).json()) as WorkspaceSnapshot;

    const completedDocument = snapshot.documents.find((d) => d.id === documentId)!;
    expect(completedDocument.latestReviewAttempt).toMatchObject({
      status: "completed",
      findingCount: 1,
    });
    expect(completedDocument.latestSuccessfulReview).toMatchObject({
      status: "completed",
    });

    const runningDocument = snapshot.documents.find(
      (d) => d.id === otherDocumentId,
    )!;
    expect(runningDocument.latestReviewAttempt).toMatchObject({
      status: "running",
      emittedFindingCount: 0,
    });
    expect(runningDocument.latestSuccessfulReview).toBeNull();

    expect(snapshot.monthlyAllowance).toMatchObject({
      completed: 1,
      reserved: 1,
      available: 8,
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("Private finding title");
    expect(serialized).not.toContain("Private explanation");
  });
});

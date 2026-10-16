import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import documentFixtures from "../../../samples/documents.json";
import lawyerFixtures from "../../../samples/lawyers.json";
import { openDatabase } from "../db/database";
import { setupDatabase } from "../db/setup";
import { ReviewService } from "./review-service";
import { createReviewRuntimeInitializer } from "./runtime";

let temporaryDirectory: string;
let databasePath: string;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), "lexroom-runtime-"));
  databasePath = path.join(temporaryDirectory, "workspace.sqlite");
  setupDatabase(databasePath);
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function withConnection<T>(run: (sqlite: ReturnType<typeof openDatabase>) => T): T {
  const sqlite = openDatabase(databasePath);
  try {
    return run(sqlite);
  } finally {
    sqlite.close();
  }
}

describe("review runtime initialization", () => {
  it("interrupts inherited running Reviews once and releases reservations", async () => {
    const requestedAt = new Date("2026-10-16T12:00:00.000Z");
    const reviewId = withConnection((sqlite) => {
      const service = new ReviewService(sqlite, () => requestedAt);
      const result = service.admit({
        documentId: documentFixtures[0].id,
        requestedByLawyerId: lawyerFixtures[0].id,
        requestId: crypto.randomUUID(),
      });
      if (result.outcome !== "created") throw new Error(result.outcome);
      service.emitFinding(result.review.id, {
        position: 0,
        clause: null,
        title: "Partial finding",
        severity: "high",
        excerpt: null,
        explanation: "Must remain hidden after interruption.",
      });
      return result.review.id;
    });

    const reconcile = vi.fn(() =>
      withConnection((sqlite) =>
        new ReviewService(
          sqlite,
          () => new Date("2026-10-16T12:05:00.000Z"),
        ).interruptRunningReviews(),
      ),
    );
    const initialize = createReviewRuntimeInitializer(reconcile);

    await Promise.all([initialize(), initialize(), initialize()]);
    await initialize();

    expect(reconcile).toHaveBeenCalledTimes(1);
    withConnection((sqlite) => {
      const snapshot = new ReviewService(
        sqlite,
        () => new Date("2026-10-16T12:05:00.000Z"),
      ).read(reviewId);
      expect(snapshot).toMatchObject({
        status: "failed",
        failedAt: "2026-10-16T12:05:00.000Z",
        failureReason: "interrupted",
      });
      expect(snapshot && "findings" in snapshot).toBe(false);
      expect(snapshot && "partialFindings" in snapshot).toBe(false);
      expect(
        sqlite
          .prepare<[], { reserved: number }>(
            "select count(*) as reserved from reviews where status = 'running'",
          )
          .get(),
      ).toEqual({ reserved: 0 });
      expect(
        sqlite
          .prepare<[], { count: number }>("select count(*) as count from findings")
          .get(),
      ).toEqual({ count: 1 });
    });
  });

  it("retries initialization after temporary failure and then stays initialized", async () => {
    const reconcile = vi
      .fn<() => void>()
      .mockImplementationOnce(() => {
        throw new Error("temporarily unavailable");
      })
      .mockImplementation(() => undefined);
    const initialize = createReviewRuntimeInitializer(reconcile);

    await expect(initialize()).rejects.toThrow("temporarily unavailable");
    await expect(initialize()).resolves.toBeUndefined();
    await expect(initialize()).resolves.toBeUndefined();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import documentFixtures from "../../../samples/documents.json";
import lawyerFixtures from "../../../samples/lawyers.json";
import { openDatabase } from "../db/database";
import { setupDatabase } from "../db/setup";
import {
  createAiFailurePlan,
  createNormalPlan,
  createProductionPlan,
  createReviewRunner,
  createSlowPlan,
  type ReviewPlan,
  type Scheduler,
} from "./review-runner";
import {
  type FindingInput,
  ReviewService,
  readReviewSnapshot,
} from "./review-service";

let temporaryDirectory: string;
let databasePath: string;
let sqlite: Database.Database;
const startedAt = new Date("2026-10-16T12:00:00.000Z");
let current = startedAt;

const documentId = documentFixtures[0].id;
const lawyerId = lawyerFixtures[0].id;

const finding = (position: number): FindingInput => ({
  position,
  clause: null,
  title: `Finding ${position}`,
  severity: "high",
  excerpt: null,
  explanation: `Explanation ${position}`,
});

function createFakeScheduler(options: { advanceClock?: boolean } = {}) {
  const scheduled: Array<{ delayMs: number; callback: () => void }> = [];
  const scheduler: Scheduler = {
    schedule(delayMs, callback) {
      scheduled.push({ delayMs, callback });
    },
  };
  return {
    scheduler,
    delays: () => scheduled.map((item) => item.delayMs),
    flush() {
      const ordered = [...scheduled].sort((a, b) => a.delayMs - b.delayMs);
      scheduled.length = 0;
      for (const item of ordered) {
        if (options.advanceClock) {
          current = new Date(startedAt.getTime() + item.delayMs);
        }
        item.callback();
      }
    },
  };
}

function admitReview(): string {
  const result = new ReviewService(sqlite, () => current).admit({
    documentId,
    requestedByLawyerId: lawyerId,
    requestId: crypto.randomUUID(),
  });
  if (result.outcome !== "created") throw new Error("expected created");
  return result.review.id;
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), "lexroom-runner-"));
  databasePath = path.join(temporaryDirectory, "workspace.sqlite");
  setupDatabase(databasePath);
  sqlite = openDatabase(databasePath);
  current = startedAt;
});

afterEach(() => {
  sqlite.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("fake review runner", () => {
  it("emits every source finding in order and completes", () => {
    const reviewId = admitReview();
    const findings = [finding(0), finding(1), finding(2)];
    const { scheduler, flush } = createFakeScheduler();
    const plan: ReviewPlan = {
      events: [
        { atMs: 1000, type: "finding", finding: findings[0] },
        { atMs: 2000, type: "finding", finding: findings[1] },
        { atMs: 3000, type: "finding", finding: findings[2] },
        { atMs: 4000, type: "complete" },
      ],
    };

    createReviewRunner({
      openDatabase: () => openDatabase(databasePath),
      now: () => current,
      scheduler,
      createPlan: () => plan,
      lookupFindings: () => findings,
    }).launch({
      reviewId,
      documentId,
      deadlineAt: "2026-10-16T12:01:00.000Z",
    });

    flush();

    const snapshot = readReviewSnapshot(sqlite, reviewId);
    expect(snapshot?.status).toBe("completed");
    if (snapshot?.status === "completed") {
      expect(snapshot.findings.map((f) => f.position)).toEqual([0, 1, 2]);
    }
  });

  it("completes a document with no source findings", () => {
    const reviewId = admitReview();
    const { scheduler, flush } = createFakeScheduler();

    createReviewRunner({
      openDatabase: () => openDatabase(databasePath),
      now: () => current,
      scheduler,
      createPlan: (findings) => createNormalPlan(findings, () => 10_000),
      lookupFindings: () => [],
    }).launch({
      reviewId,
      documentId,
      deadlineAt: "2026-10-16T12:01:00.000Z",
    });

    flush();

    const snapshot = readReviewSnapshot(sqlite, reviewId);
    expect(snapshot?.status).toBe("completed");
    if (snapshot?.status === "completed") expect(snapshot.findings).toEqual([]);
  });

  it.each([0, 2, 3])(
    "fails after a source-ordered prefix of %i Findings and hides partial results",
    (prefixLength) => {
      const reviewId = admitReview();
      const findings = [finding(0), finding(1), finding(2)];
      const { scheduler, flush } = createFakeScheduler({ advanceClock: true });

      createReviewRunner({
        openDatabase: () => openDatabase(databasePath),
        now: () => current,
        scheduler,
        createPlan: (source) =>
          createAiFailurePlan(source, { prefixLength, terminalAtMs: 10_000 }),
        lookupFindings: () => findings,
      }).launch({
        reviewId,
        documentId,
        deadlineAt: "2026-10-16T12:01:00.000Z",
      });

      flush();

      const snapshot = readReviewSnapshot(sqlite, reviewId);
      expect(snapshot?.status).toBe("failed");
      if (snapshot?.status === "failed") {
        expect(snapshot.failureReason).toBe("ai_error");
        expect("findings" in snapshot).toBe(false);
        expect("partialFindings" in snapshot).toBe(false);
      }
      expect(
        sqlite
          .prepare<[string], { count: number }>(
            "select count(*) as count from findings where review_id = ?",
          )
          .get(reviewId),
      ).toEqual({ count: prefixLength });
    },
  );

  it("times out a slow plan through the scheduled deadline timer", () => {
    const reviewId = admitReview();
    const { scheduler, flush } = createFakeScheduler({ advanceClock: true });

    createReviewRunner({
      openDatabase: () => openDatabase(databasePath),
      now: () => current,
      scheduler,
      createPlan: (findings) => createSlowPlan(findings, 90_000),
      lookupFindings: () => [finding(0)],
    }).launch({
      reviewId,
      documentId,
      deadlineAt: "2026-10-16T12:01:00.000Z",
    });

    flush();
    const snapshot = readReviewSnapshot(sqlite, reviewId);
    expect(snapshot?.status).toBe("failed");
    if (snapshot?.status === "failed") {
      expect(snapshot.failureReason).toBe("timed_out");
    }
    expect(
      sqlite
        .prepare<[string], { count: number }>(
          "select count(*) as count from findings where review_id = ?",
        )
        .get(reviewId),
    ).toEqual({ count: 0 });
  });

  it("fails an accepted review when its fixture is missing, releasing the reservation", () => {
    const reviewId = admitReview();
    const { scheduler } = createFakeScheduler();

    createReviewRunner({
      openDatabase: () => openDatabase(databasePath),
      now: () => current,
      scheduler,
      createPlan: () => {
        throw new Error("should not plan without a fixture");
      },
      lookupFindings: () => undefined,
      logger: { error: vi.fn() },
    }).launch({
      reviewId,
      documentId,
      deadlineAt: "2026-10-16T12:01:00.000Z",
    });

    const snapshot = readReviewSnapshot(sqlite, reviewId);
    expect(snapshot?.status).toBe("failed");
    if (snapshot?.status === "failed") {
      expect(snapshot.failureReason).toBe("ai_error");
    }
    const reserved = sqlite
      .prepare<[], { reserved: number }>(
        "select count(*) as reserved from reviews where status = 'running'",
      )
      .get();
    expect(reserved).toEqual({ reserved: 0 });
  });
});

describe("production plans", () => {
  it("chooses the agreed 70/20/10 outcome boundaries", () => {
    const findings = [finding(0)];
    expect(createProductionPlan(findings, () => 0.699).events.at(-1)?.type).toBe("complete");
    expect(createProductionPlan(findings, () => 0.7).events.at(-1)?.type).toBe("fail");
    const slow = createProductionPlan(findings, () => 0.9);
    expect(slow.events.at(-1)?.type).toBe("complete");
    expect(slow.events[0].atMs).toBeGreaterThanOrEqual(60_000);
  });

  it("rejects an invalid explicit plan and fails the accepted Review", () => {
    const reviewId = admitReview();
    const { scheduler } = createFakeScheduler();

    createReviewRunner({
      openDatabase: () => openDatabase(databasePath),
      now: () => current,
      scheduler,
      createPlan: () => ({
        events: [
          { atMs: 10_000, type: "complete" },
          { atMs: 5_000, type: "complete" },
        ],
      }),
      lookupFindings: () => [],
      logger: { error: vi.fn() },
    }).launch({
      reviewId,
      documentId,
      deadlineAt: "2026-10-16T12:01:00.000Z",
    });

    const snapshot = readReviewSnapshot(sqlite, reviewId);
    expect(snapshot?.status).toBe("failed");
    if (snapshot?.status === "failed") {
      expect(snapshot.failureReason).toBe("ai_error");
    }
  });
});

describe("createNormalPlan", () => {
  it("schedules every finding in source order then completion with strictly increasing offsets", () => {
    const findings = [finding(0), finding(1), finding(2)];
    const plan = createNormalPlan(findings, () => 20_000);

    const findingEvents = plan.events.filter((event) => event.type === "finding");
    expect(findingEvents.map((event) => (event as { finding: FindingInput }).finding.position)).toEqual(
      [0, 1, 2],
    );
    expect(plan.events.at(-1)?.type).toBe("complete");

    const offsets = plan.events.map((event) => event.atMs);
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
    expect(offsets.at(-1)).toBeLessThanOrEqual(20_000);
  });

  it("schedules a single completion for a document with no findings", () => {
    const plan = createNormalPlan([], () => 7_000);
    expect(plan.events).toEqual([{ atMs: 7_000, type: "complete" }]);
  });

  it("keeps production offsets inside the 5–30 second window", () => {
    const plan = createNormalPlan([finding(0)]);
    for (const event of plan.events) {
      expect(event.atMs).toBeGreaterThan(0);
      expect(event.atMs).toBeLessThanOrEqual(30_000);
    }
  });
});

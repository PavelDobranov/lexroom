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
  createNormalPlan,
  createReviewRunner,
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
const current = new Date("2026-10-16T12:00:00.000Z");

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

function createFakeScheduler() {
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
      for (const item of ordered) item.callback();
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
    }).launch({ reviewId, documentId });

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
    }).launch({ reviewId, documentId });

    flush();

    const snapshot = readReviewSnapshot(sqlite, reviewId);
    expect(snapshot?.status).toBe("completed");
    if (snapshot?.status === "completed") expect(snapshot.findings).toEqual([]);
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
    }).launch({ reviewId, documentId });

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

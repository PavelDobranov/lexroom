import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import documentFixtures from "../../../samples/documents.json";
import lawyerFixtures from "../../../samples/lawyers.json";
import { openDatabase } from "../db/database";
import { setupDatabase } from "../db/setup";
import {
  type AdmissionInput,
  type FindingInput,
  ReviewService,
} from "./review-service";

let temporaryDirectory: string;
let databasePath: string;
let sqlite: Database.Database;
let current: Date;

const documents = documentFixtures.map((document) => document.id);
const lawyerId = lawyerFixtures[0].id;
const otherLawyerId = lawyerFixtures[1].id;

function service(): ReviewService {
  return new ReviewService(sqlite, () => current);
}

function admission(overrides: Partial<AdmissionInput> = {}): AdmissionInput {
  return {
    documentId: documents[0],
    requestedByLawyerId: lawyerId,
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

const finding = (position: number): FindingInput => ({
  position,
  clause: `${position}.0`,
  title: `Finding ${position}`,
  severity: "medium",
  excerpt: `Excerpt ${position}`,
  explanation: `Explanation ${position}`,
});

/** Seeds a terminal or running review directly, for allowance scenarios. */
function seed(options: {
  status: "running" | "completed";
  month: string;
  documentId: string;
  key: string;
}): void {
  const requestedAt = `${options.month}-15T10:00:00.000Z`;
  const deadlineAt = options.status === "running"
    ? `${options.month}-31T23:59:59.000Z`
    : `${options.month}-15T10:01:00.000Z`;
  sqlite
    .prepare(`
      insert into reviews (
        id, document_id, requested_by_lawyer_id, request_id, status,
        allowance_month, requested_at, deadline_at, completed_at
      ) values (@id, @documentId, @lawyerId, @requestId, @status, @month, @requestedAt, @deadlineAt, @completedAt)
    `)
    .run({
      id: `seed-${options.key}`,
      documentId: options.documentId,
      lawyerId,
      requestId: `seed-req-${options.key}`,
      status: options.status,
      month: options.month,
      requestedAt,
      deadlineAt,
      completedAt: options.status === "completed" ? requestedAt : null,
    });
}

function allowanceCounts(month: string): { completed: number; reserved: number } {
  const row = sqlite
    .prepare<[string], { completed: number | null; reserved: number | null }>(`
      select
        sum(case when status = 'completed' then 1 else 0 end) as completed,
        sum(case when status = 'running' then 1 else 0 end) as reserved
      from reviews where allowance_month = ?
    `)
    .get(month)!;
  return { completed: row.completed ?? 0, reserved: row.reserved ?? 0 };
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), "lexroom-review-service-"));
  databasePath = path.join(temporaryDirectory, "workspace.sqlite");
  setupDatabase(databasePath);
  sqlite = openDatabase(databasePath);
  current = new Date("2026-10-16T12:00:00.000Z");
});

afterEach(() => {
  sqlite.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("admission", () => {
  it("creates one running review that reserves its UTC request month", () => {
    const result = service().admit(admission());

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("expected created");
    expect(result.review.status).toBe("running");
    expect(result.review.allowanceMonth).toBe("2026-10");
    expect(result.review.requestedAt).toBe("2026-10-16T12:00:00.000Z");
    if (result.review.status === "running") {
      expect(result.review.deadlineAt).toBe("2026-10-16T12:01:00.000Z");
      expect(result.review.partialFindings).toEqual([]);
    }
    expect(allowanceCounts("2026-10")).toMatchObject({ completed: 0, reserved: 1 });
  });

  it("replays a matching request ID without a second reservation", () => {
    const input = admission();
    const first = service().admit(input);
    const second = service().admit(input);

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("replayed");
    if (first.outcome !== "created" || second.outcome !== "replayed") {
      throw new Error("unexpected outcomes");
    }
    expect(second.review.id).toBe(first.review.id);
    expect(allowanceCounts("2026-10")).toMatchObject({ reserved: 1 });
  });

  it("rejects a reused request ID with a different document or lawyer", () => {
    const requestId = crypto.randomUUID();
    service().admit(admission({ requestId, documentId: documents[0] }));

    expect(
      service().admit(admission({ requestId, documentId: documents[1] }))
        .outcome,
    ).toBe("request_id_conflict");
    expect(
      service().admit(
        admission({ requestId, requestedByLawyerId: otherLawyerId }),
      ).outcome,
    ).toBe("request_id_conflict");
  });

  it("validates document and lawyer references", () => {
    expect(
      service().admit(admission({ documentId: "missing-document" })).outcome,
    ).toBe("document_not_found");
    expect(
      service().admit(admission({ requestedByLawyerId: "missing-lawyer" }))
        .outcome,
    ).toBe("lawyer_not_found");
  });

  it("allows only one running review per document", () => {
    service().admit(admission({ documentId: documents[0] }));
    expect(
      service().admit(admission({ documentId: documents[0] })).outcome,
    ).toBe("review_already_running");
    expect(
      service().admit(admission({ documentId: documents[1] })).outcome,
    ).toBe("created");
  });

  it("denies exhausted and temporarily reserved allowance in precedence order", () => {
    for (let i = 0; i < 10; i += 1) {
      seed({ status: "completed", month: "2026-10", documentId: documents[i], key: `c${i}` });
    }
    expect(service().admit(admission({ documentId: documents[11] })).outcome).toBe(
      "allowance_exhausted",
    );

    // Reset to 9 completed + 1 running = fully reserved but not exhausted.
    sqlite.exec("delete from reviews");
    for (let i = 0; i < 9; i += 1) {
      seed({ status: "completed", month: "2026-10", documentId: documents[i], key: `c${i}` });
    }
    seed({ status: "running", month: "2026-10", documentId: documents[9], key: "r0" });
    expect(service().admit(admission({ documentId: documents[11] })).outcome).toBe(
      "allowance_temporarily_reserved",
    );
  });

  it("returns review_already_running before an allowance denial", () => {
    for (let i = 0; i < 10; i += 1) {
      seed({ status: "completed", month: "2026-10", documentId: documents[i], key: `c${i}` });
    }
    seed({ status: "running", month: "2026-10", documentId: documents[11], key: "run" });
    // documents[11] is both running and the month is exhausted; concurrency wins.
    expect(service().admit(admission({ documentId: documents[11] })).outcome).toBe(
      "review_already_running",
    );
  });

  it("derives the request month from UTC across a month boundary", () => {
    current = new Date("2026-10-31T23:59:59.000Z");
    const october = service().admit(admission({ documentId: documents[0] }));
    current = new Date("2026-11-01T00:00:00.000Z");
    const november = service().admit(admission({ documentId: documents[1] }));

    if (october.outcome !== "created" || november.outcome !== "created") {
      throw new Error("expected created");
    }
    expect(october.review.allowanceMonth).toBe("2026-10");
    expect(november.review.allowanceMonth).toBe("2026-11");
  });
});

describe("finding emission and completion", () => {
  it("persists source-ordered findings exactly once and completes", () => {
    const created = service().admit(admission());
    if (created.outcome !== "created") throw new Error("expected created");
    const reviewId = created.review.id;

    service().emitFinding(reviewId, finding(0));
    service().emitFinding(reviewId, finding(1));
    service().emitFinding(reviewId, finding(0)); // duplicate position is ignored

    const running = service().emitFinding(reviewId, finding(2));
    expect(running?.status).toBe("running");
    if (running?.status === "running") {
      expect(running.partialFindings.map((f) => f.position)).toEqual([0, 1, 2]);
      expect(running.partialFindings[0].emittedAt).toBe(
        "2026-10-16T12:00:00.000Z",
      );
    }

    const completed = service().complete(reviewId);
    expect(completed?.status).toBe("completed");
    if (completed?.status === "completed") {
      expect(completed.findings.map((f) => f.position)).toEqual([0, 1, 2]);
    }
    expect(allowanceCounts("2026-10")).toMatchObject({ completed: 1, reserved: 0 });
  });

  it("completes a zero-finding review successfully and consumes allowance", () => {
    const created = service().admit(admission());
    if (created.outcome !== "created") throw new Error("expected created");

    const completed = service().complete(created.review.id);
    expect(completed?.status).toBe("completed");
    if (completed?.status === "completed") expect(completed.findings).toEqual([]);
    expect(allowanceCounts("2026-10")).toMatchObject({ completed: 1, reserved: 0 });
  });

  it("releases the reservation when a review fails", () => {
    const created = service().admit(admission());
    if (created.outcome !== "created") throw new Error("expected created");

    const failed = service().fail(created.review.id, "ai_error");
    expect(failed?.status).toBe("failed");
    if (failed?.status === "failed") {
      expect(failed.failureReason).toBe("ai_error");
      expect("findings" in failed).toBe(false);
      expect("partialFindings" in failed).toBe(false);
    }
    expect(allowanceCounts("2026-10")).toMatchObject({ completed: 0, reserved: 0 });
  });

  it("charges a cross-month completion to its original request month", () => {
    current = new Date("2026-10-31T23:59:30.000Z");
    const created = service().admit(admission());
    if (created.outcome !== "created") throw new Error("expected created");

    // Complete after midnight UTC but before the 60-second deadline.
    current = new Date("2026-11-01T00:00:10.000Z");
    const completed = service().complete(created.review.id);

    expect(completed?.status).toBe("completed");
    expect(completed?.allowanceMonth).toBe("2026-10");
    expect(allowanceCounts("2026-10")).toMatchObject({ completed: 1, reserved: 0 });
    expect(allowanceCounts("2026-11")).toMatchObject({ completed: 0, reserved: 0 });
  });

  it("rejects callbacks after a terminal status as safe no-ops", () => {
    const created = service().admit(admission());
    if (created.outcome !== "created") throw new Error("expected created");
    const reviewId = created.review.id;

    service().complete(reviewId);
    const afterComplete = service().emitFinding(reviewId, finding(0));
    expect(afterComplete?.status).toBe("completed");
    if (afterComplete?.status === "completed") {
      expect(afterComplete.findings).toEqual([]);
    }
  });

  it("permanently times out at exactly 60 seconds and rejects every late callback", () => {
    const created = service().admit(admission());
    if (created.outcome !== "created") throw new Error("expected created");
    const reviewId = created.review.id;

    current = new Date("2026-10-16T12:01:00.000Z"); // exactly 60 seconds
    const timedOut = service().emitFinding(reviewId, finding(0));
    expect(timedOut?.status).toBe("failed");
    if (timedOut?.status === "failed") {
      expect(timedOut.failureReason).toBe("timed_out");
      expect("findings" in timedOut).toBe(false);
      expect("partialFindings" in timedOut).toBe(false);
    }

    expect(service().complete(reviewId)).toEqual(timedOut);
    expect(service().fail(reviewId, "ai_error")).toEqual(timedOut);
    expect(service().emitFinding(reviewId, finding(1))).toEqual(timedOut);
    expect(allowanceCounts("2026-10")).toEqual({ completed: 0, reserved: 0 });
  });

  it("lets completion win before the deadline and timeout win when processed first", () => {
    const completedFirst = service().admit(admission({ documentId: documents[0] }));
    if (completedFirst.outcome !== "created") throw new Error("expected created");
    current = new Date("2026-10-16T12:00:59.999Z");
    expect(service().complete(completedFirst.review.id)?.status).toBe("completed");
    current = new Date("2026-10-16T12:01:00.000Z");
    expect(service().expire(completedFirst.review.id)?.status).toBe("completed");

    current = new Date("2026-10-16T13:00:00.000Z");
    const timeoutFirst = service().admit(admission({ documentId: documents[1] }));
    if (timeoutFirst.outcome !== "created") throw new Error("expected created");
    current = new Date("2026-10-16T13:01:00.000Z");
    expect(service().expire(timeoutFirst.review.id)?.status).toBe("failed");
    expect(service().complete(timeoutFirst.review.id)?.status).toBe("failed");
  });

  it("lets a Finding win before timeout and rejects it when timeout wins first", () => {
    const findingFirst = service().admit(admission({ documentId: documents[0] }));
    if (findingFirst.outcome !== "created") throw new Error("expected created");
    current = new Date("2026-10-16T12:00:59.999Z");
    expect(service().emitFinding(findingFirst.review.id, finding(0))?.status).toBe("running");
    current = new Date("2026-10-16T12:01:00.000Z");
    const expired = service().expire(findingFirst.review.id);
    expect(expired?.status).toBe("failed");
    expect(sqlite.prepare("select count(*) as count from findings where review_id = ?").get(findingFirst.review.id)).toEqual({ count: 1 });

    current = new Date("2026-10-16T14:00:00.000Z");
    const timeoutFirst = service().admit(admission({ documentId: documents[1] }));
    if (timeoutFirst.outcome !== "created") throw new Error("expected created");
    current = new Date("2026-10-16T14:01:00.000Z");
    service().expire(timeoutFirst.review.id);
    expect(service().emitFinding(timeoutFirst.review.id, finding(0))?.status).toBe("failed");
    expect(sqlite.prepare("select count(*) as count from findings where review_id = ?").get(timeoutFirst.review.id)).toEqual({ count: 0 });
  });
});

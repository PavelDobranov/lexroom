import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import documentFixtures from "../../../samples/documents.json";
import lawyerFixtures from "../../../samples/lawyers.json";
import { openDatabase } from "./database";
import { setupDatabase } from "./setup";

let temporaryDirectory: string;
let databasePath: string;
let sqlite: Database.Database;

const documentId = documentFixtures[0].id;
const otherDocumentId = documentFixtures[1].id;
const lawyerId = lawyerFixtures[0].id;

const VALID_REQUESTED_AT = "2026-10-16T12:00:00.000Z";
const VALID_DEADLINE_AT = "2026-10-16T12:01:00.000Z";

function insertReview(overrides: Record<string, unknown> = {}): void {
  const review = {
    id: `review-${Math.random().toString(36).slice(2)}`,
    document_id: documentId,
    requested_by_lawyer_id: lawyerId,
    request_id: `request-${Math.random().toString(36).slice(2)}`,
    status: "running",
    allowance_month: "2026-10",
    requested_at: VALID_REQUESTED_AT,
    deadline_at: VALID_DEADLINE_AT,
    completed_at: null,
    failed_at: null,
    failure_reason: null,
    ...overrides,
  };
  sqlite
    .prepare(`
      insert into reviews (
        id, document_id, requested_by_lawyer_id, request_id, status,
        allowance_month, requested_at, deadline_at, completed_at, failed_at, failure_reason
      ) values (
        @id, @document_id, @requested_by_lawyer_id, @request_id, @status,
        @allowance_month, @requested_at, @deadline_at, @completed_at, @failed_at, @failure_reason
      )
    `)
    .run(review);
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), "lexroom-review-schema-"));
  databasePath = path.join(temporaryDirectory, "workspace.sqlite");
  setupDatabase(databasePath);
  sqlite = openDatabase(databasePath);
});

afterEach(() => {
  sqlite.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("reviews table constraints", () => {
  it("accepts a well-formed running review", () => {
    expect(() => insertReview()).not.toThrow();
  });

  it("rejects an unknown status and failure reason", () => {
    expect(() => insertReview({ status: "queued" })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() =>
      insertReview({
        status: "failed",
        failed_at: VALID_REQUESTED_AT,
        failure_reason: "exploded",
      }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("rejects a malformed allowance month", () => {
    expect(() => insertReview({ allowance_month: "2026-13" })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insertReview({ allowance_month: "oct-26" })).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("enforces terminal-field consistency per status", () => {
    expect(() =>
      insertReview({ completed_at: VALID_REQUESTED_AT }),
    ).toThrow(/CHECK constraint failed/); // running cannot carry a completion time
    expect(() => insertReview({ status: "completed" })).toThrow(
      /CHECK constraint failed/,
    ); // completed needs completed_at
    expect(() =>
      insertReview({
        status: "completed",
        completed_at: VALID_REQUESTED_AT,
        failure_reason: "ai_error",
      }),
    ).toThrow(/CHECK constraint failed/); // completed cannot carry failure fields
    expect(() => insertReview({ status: "failed", failed_at: VALID_REQUESTED_AT })).toThrow(
      /CHECK constraint failed/,
    ); // failed needs a reason
  });

  it("enforces one running review per document with a partial unique index", () => {
    insertReview();
    expect(() => insertReview()).toThrow(/UNIQUE constraint failed/);

    // A terminal review for the same document does not block a new running one.
    expect(() =>
      insertReview({
        status: "completed",
        completed_at: VALID_REQUESTED_AT,
      }),
    ).not.toThrow();
    // A second document may run concurrently.
    expect(() => insertReview({ document_id: otherDocumentId })).not.toThrow();
  });

  it("enforces globally unique request IDs", () => {
    insertReview({ request_id: "shared", document_id: documentId });
    expect(() =>
      insertReview({
        request_id: "shared",
        document_id: otherDocumentId,
      }),
    ).toThrow(/UNIQUE constraint failed/);
  });
});

describe("findings table constraints", () => {
  function insertFinding(overrides: Record<string, unknown> = {}): void {
    const finding = {
      review_id: "finding-review",
      position: 0,
      clause: null,
      title: "Title",
      severity: "low",
      excerpt: null,
      explanation: "Explanation",
      emitted_at: VALID_REQUESTED_AT,
      ...overrides,
    };
    sqlite
      .prepare(`
        insert into findings (
          review_id, position, clause, title, severity, excerpt, explanation, emitted_at
        ) values (
          @review_id, @position, @clause, @title, @severity, @excerpt, @explanation, @emitted_at
        )
      `)
      .run(finding);
  }

  beforeEach(() => {
    insertReview({ id: "finding-review" });
  });

  it("rejects a negative position and an unknown severity", () => {
    expect(() => insertFinding({ position: -1 })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insertFinding({ severity: "critical" })).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("enforces unique positions per review", () => {
    insertFinding({ position: 0 });
    expect(() => insertFinding({ position: 0 })).toThrow(
      /UNIQUE constraint failed|PRIMARY KEY/,
    );
    expect(() => insertFinding({ position: 1 })).not.toThrow();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import documentFixtures from "../../../samples/documents.json";
import lawyerFixtures from "../../../samples/lawyers.json";
import { openDatabase } from "../db/database";
import { setupDatabase } from "../db/setup";
import { ReviewService } from "./review-service";

let temporaryDirectory: string;
let databasePath: string;
const now = () => new Date("2026-10-16T12:00:00.000Z");

const documents = documentFixtures.map((document) => document.id);
const lawyerId = lawyerFixtures[0].id;

function admit(sqlite: Database.Database, documentId: string) {
  return new ReviewService(sqlite, now).admit({
    documentId,
    requestedByLawyerId: lawyerId,
    requestId: crypto.randomUUID(),
  });
}

function seedCompleted(sqlite: Database.Database, count: number): void {
  for (let i = 0; i < count; i += 1) {
    sqlite
      .prepare(`
        insert into reviews (
          id, document_id, requested_by_lawyer_id, request_id, status,
          allowance_month, requested_at, deadline_at, completed_at
        ) values (?, ?, ?, ?, 'completed', '2026-10', '2026-10-15T10:00:00.000Z', '2026-10-15T10:01:00.000Z', '2026-10-15T10:00:30.000Z')
      `)
      .run(`seed-${i}`, documents[i], lawyerId, `seed-req-${i}`);
  }
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), "lexroom-contention-"));
  databasePath = path.join(temporaryDirectory, "workspace.sqlite");
  setupDatabase(databasePath);
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("admission contention", () => {
  it("never creates two running reviews for one document across independent connections", () => {
    const connectionA = openDatabase(databasePath);
    const connectionB = openDatabase(databasePath);
    try {
      expect(admit(connectionA, documents[0]).outcome).toBe("created");
      // A second, independent connection observes the committed running review.
      expect(admit(connectionB, documents[0]).outcome).toBe(
        "review_already_running",
      );

      const running = connectionB
        .prepare<[string], { count: number }>(
          "select count(*) as count from reviews where document_id = ? and status = 'running'",
        )
        .get(documents[0]);
      expect(running).toEqual({ count: 1 });
    } finally {
      connectionA.close();
      connectionB.close();
    }
  });

  it("independently enforces the partial unique index at the database level", () => {
    const connection = openDatabase(databasePath);
    try {
      admit(connection, documents[0]);
      expect(() =>
        connection
          .prepare(`
            insert into reviews (
              id, document_id, requested_by_lawyer_id, request_id, status,
              allowance_month, requested_at, deadline_at
            ) values ('raw', ?, ?, 'raw-req', 'running', '2026-10', '2026-10-16T12:00:00.000Z', '2026-10-16T12:01:00.000Z')
          `)
          .run(documents[0], lawyerId),
      ).toThrow(/UNIQUE constraint failed/);
    } finally {
      connection.close();
    }
  });

  it("cannot consume the final allowance slot twice across different documents", () => {
    const connectionA = openDatabase(databasePath);
    const connectionB = openDatabase(databasePath);
    try {
      seedCompleted(connectionA, 9); // one slot remains

      expect(admit(connectionA, documents[10]).outcome).toBe("created");
      // The reservation from connection A leaves no capacity for a different document.
      expect(admit(connectionB, documents[11]).outcome).toBe(
        "allowance_temporarily_reserved",
      );
    } finally {
      connectionA.close();
      connectionB.close();
    }
  });
});

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import documentFixtures from "../../samples/documents.json";
import lawyerFixtures from "../../samples/lawyers.json";
import type { WorkspaceSnapshot } from "../shared/api";
import { createApi } from "./app";
import { openDatabase } from "./db/database";
import { setupDatabase } from "./db/setup";

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
  logger: Pick<Console, "error"> = { error: vi.fn() },
) {
  return createApi({
    openWorkspaceDatabase: () => openDatabase(databasePath),
    now: () => now,
    logger,
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

    const response = await apiFor(new Date(), logger).request("/api/workspace");

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

    const response = await apiFor(new Date(), logger).request("/api/workspace");

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

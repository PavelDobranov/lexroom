import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import documentFixtures from "../../../samples/documents.json";
import lawyerFixtures from "../../../samples/lawyers.json";
import { openDatabase } from "./database";
import { FixtureConflictError, setupDatabase } from "./setup";

let temporaryDirectory: string;
let databasePath: string;

beforeEach(() => {
  temporaryDirectory = mkdtempSync(path.join(tmpdir(), "lexroom-db-"));
  databasePath = path.join(temporaryDirectory, "workspace.sqlite");
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("database setup", () => {
  it("migrates a fresh database and loads every public sample record", () => {
    setupDatabase(databasePath);

    const sqlite = openDatabase(databasePath);
    try {
      const domainTables = sqlite
        .prepare<[], { name: string }>(`
          select name from sqlite_schema
          where type = 'table'
            and name not like 'sqlite_%'
            and name != '__drizzle_migrations'
          order by name
        `)
        .all()
        .map(({ name }) => name);

      expect(domainTables).toEqual(["documents", "lawyers"]);
      expect(
        sqlite.prepare("select count(*) as count from lawyers").get(),
      ).toEqual({ count: lawyerFixtures.length });
      expect(
        sqlite.prepare("select count(*) as count from documents").get(),
      ).toEqual({ count: documentFixtures.length });

      expect(
        sqlite
          .prepare(`
            select id, name, title from lawyers order by id
          `)
          .all(),
      ).toEqual([...lawyerFixtures].sort((left, right) => left.id.localeCompare(right.id)));
      expect(
        sqlite
          .prepare(`
            select
              id,
              title,
              type,
              pages,
              uploaded_at as uploadedAt,
              uploaded_by_lawyer_id as uploadedByLawyerId,
              supersedes_document_id as supersedesDocumentId
            from documents
            order by id
          `)
          .all(),
      ).toEqual(
        documentFixtures
          .map((document) => ({
            id: document.id,
            title: document.title,
            type: document.type,
            pages: document.pages,
            uploadedAt: document.uploadedAt,
            uploadedByLawyerId: document.uploadedBy,
            supersedesDocumentId: document.supersedes,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      );
    } finally {
      sqlite.close();
    }
  });

  it("can run repeatedly without updating, deleting, or duplicating rows", () => {
    setupDatabase(databasePath);

    const sqlite = openDatabase(databasePath);
    try {
      sqlite.exec(`
        insert into lawyers (id, name, title)
        values ('unrelated-lawyer', 'Unrelated Lawyer', 'Counsel');

        insert into documents (
          id, title, type, pages, uploaded_at, uploaded_by_lawyer_id
        ) values (
          'unrelated-document', 'Unrelated contract', 'other', 2,
          '2026-01-01T00:00:00Z', 'unrelated-lawyer'
        );

        create trigger reject_lawyer_updates
        before update on lawyers begin
          select raise(abort, 'lawyers must not be updated');
        end;
        create trigger reject_lawyer_deletes
        before delete on lawyers begin
          select raise(abort, 'lawyers must not be deleted');
        end;
        create trigger reject_document_updates
        before update on documents begin
          select raise(abort, 'documents must not be updated');
        end;
        create trigger reject_document_deletes
        before delete on documents begin
          select raise(abort, 'documents must not be deleted');
        end;
      `);
    } finally {
      sqlite.close();
    }

    setupDatabase(databasePath);
    setupDatabase(databasePath);

    const reopened = openDatabase(databasePath);
    try {
      expect(reopened.prepare("select count(*) as count from lawyers").get()).toEqual(
        { count: lawyerFixtures.length + 1 },
      );
      expect(
        reopened.prepare("select count(*) as count from documents").get(),
      ).toEqual({ count: documentFixtures.length + 1 });
      expect(
        reopened
          .prepare("select name, title from lawyers where id = 'unrelated-lawyer'")
          .get(),
      ).toEqual({ name: "Unrelated Lawyer", title: "Counsel" });
    } finally {
      reopened.close();
    }
  });

  it("rolls back all fixture inserts when an existing sample conflicts", () => {
    setupDatabase(databasePath);

    const conflictingLawyer = lawyerFixtures[1];
    const firstLawyer = lawyerFixtures[0];
    const sqlite = openDatabase(databasePath);
    try {
      sqlite.exec("delete from documents");
      sqlite
        .prepare("delete from lawyers where id = ?")
        .run(firstLawyer.id);
      sqlite
        .prepare("update lawyers set title = ? where id = ?")
        .run("Conflicting title", conflictingLawyer.id);
    } finally {
      sqlite.close();
    }

    expect(() => setupDatabase(databasePath)).toThrowError(
      new FixtureConflictError("lawyer", conflictingLawyer.id),
    );

    const reopened = openDatabase(databasePath);
    try {
      expect(
        reopened.prepare("select title from lawyers where id = ?").get(
          conflictingLawyer.id,
        ),
      ).toEqual({ title: "Conflicting title" });
      expect(
        reopened.prepare("select id from lawyers where id = ?").get(firstLawyer.id),
      ).toBeUndefined();
      expect(
        reopened.prepare("select count(*) as count from documents").get(),
      ).toEqual({ count: 0 });
    } finally {
      reopened.close();
    }
  });

  it("rolls back earlier fixture inserts when a document conflicts", () => {
    setupDatabase(databasePath);

    const conflictingDocument = documentFixtures.at(-1)!;
    const firstDocument = documentFixtures[0];
    const sqlite = openDatabase(databasePath);
    try {
      sqlite
        .prepare("delete from documents where id != ?")
        .run(conflictingDocument.id);
      sqlite
        .prepare("update documents set title = ? where id = ?")
        .run("Conflicting title", conflictingDocument.id);
    } finally {
      sqlite.close();
    }

    expect(() => setupDatabase(databasePath)).toThrowError(
      new FixtureConflictError("document", conflictingDocument.id),
    );

    const reopened = openDatabase(databasePath);
    try {
      expect(reopened.prepare("select count(*) as count from documents").get()).toEqual(
        { count: 1 },
      );
      expect(
        reopened.prepare("select title from documents where id = ?").get(
          conflictingDocument.id,
        ),
      ).toEqual({ title: "Conflicting title" });
      expect(
        reopened.prepare("select id from documents where id = ?").get(firstDocument.id),
      ).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it("enables and satisfies uploader and supersedes foreign keys", () => {
    setupDatabase(databasePath);

    const sqlite = openDatabase(databasePath);
    try {
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(() =>
        sqlite
          .prepare(`
            insert into documents (
              id, title, type, pages, uploaded_at, uploaded_by_lawyer_id
            ) values (?, ?, ?, ?, ?, ?)
          `)
          .run(
            "invalid-uploader",
            "Invalid",
            "other",
            1,
            "2026-01-01T00:00:00Z",
            "missing-lawyer",
          ),
      ).toThrow(/FOREIGN KEY constraint failed/);
      expect(() =>
        sqlite
          .prepare(`
            insert into documents (
              id, title, type, pages, uploaded_at, uploaded_by_lawyer_id,
              supersedes_document_id
            ) values (?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            "invalid-supersedes",
            "Invalid",
            "other",
            1,
            "2026-01-01T00:00:00Z",
            lawyerFixtures[0].id,
            "missing-document",
          ),
      ).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      sqlite.close();
    }
  });

  it("enforces the non-empty, positive-page, and UTC timestamp checks", () => {
    setupDatabase(databasePath);

    const sqlite = openDatabase(databasePath);
    try {
      expect(() =>
        sqlite
          .prepare("insert into lawyers (id, name, title) values (?, ?, ?)")
          .run("blank-name", "   ", "Partner"),
      ).toThrow(/CHECK constraint failed/);
      expect(() =>
        sqlite
          .prepare(`
            insert into documents (
              id, title, type, pages, uploaded_at, uploaded_by_lawyer_id
            ) values (?, ?, ?, ?, ?, ?)
          `)
          .run(
            "zero-pages",
            "Invalid",
            "other",
            0,
            "2026-01-01T00:00:00Z",
            lawyerFixtures[0].id,
          ),
      ).toThrow(/CHECK constraint failed/);
      const insertDocument = sqlite.prepare(`
        insert into documents (
          id, title, type, pages, uploaded_at, uploaded_by_lawyer_id
        ) values (?, ?, ?, ?, ?, ?)
      `);
      expect(() =>
        insertDocument.run(
          "local-timestamp",
          "Invalid",
          "other",
          1,
          "2026-01-01 00:00:00",
          lawyerFixtures[0].id,
        ),
      ).toThrow(/CHECK constraint failed/);
      expect(() =>
        insertDocument.run(
          "impossible-date",
          "Invalid",
          "other",
          1,
          "2026-02-30T00:00:00Z",
          lawyerFixtures[0].id,
        ),
      ).toThrow(/CHECK constraint failed/);
      expect(() =>
        insertDocument.run(
          "fractional-seconds",
          "Valid",
          "other",
          1,
          "2026-02-28T00:00:00.123456Z",
          lawyerFixtures[0].id,
        ),
      ).not.toThrow();
    } finally {
      sqlite.close();
    }
  });

  it("persists only allowlisted public document fields", () => {
    setupDatabase(databasePath);

    const sqlite = openDatabase(databasePath);
    try {
      const columns = sqlite
        .prepare<[], { name: string }>("pragma table_info(documents)")
        .all()
        .map(({ name }) => name);
      const schema = sqlite
        .prepare<[], { sql: string }>(
          "select sql from sqlite_schema where name = 'documents'",
        )
        .get();
      const persistedDocuments = sqlite
        .prepare("select * from documents order by id")
        .all();

      expect(columns).toEqual([
        "id",
        "title",
        "type",
        "pages",
        "uploaded_at",
        "uploaded_by_lawyer_id",
        "supersedes_document_id",
      ]);
      expect(schema?.sql.toLowerCase()).not.toContain("finding");
      const persistedJson = JSON.stringify(persistedDocuments);
      expect(persistedJson).not.toContain("findings");
      for (const document of documentFixtures) {
        for (const finding of document.findings) {
          for (const privateValue of [
            finding.title,
            finding.excerpt,
            finding.explanation,
          ]) {
            if (privateValue !== null) {
              expect(persistedJson).not.toContain(privateValue);
            }
          }
        }
      }
    } finally {
      sqlite.close();
    }
  });

  it("retains initialized records after closing and reopening the file", () => {
    setupDatabase(databasePath);

    const firstConnection = openDatabase(databasePath);
    expect(
      firstConnection.prepare("select count(*) as count from documents").get(),
    ).toEqual({ count: documentFixtures.length });
    firstConnection.close();

    const secondConnection = openDatabase(databasePath);
    try {
      expect(
        secondConnection.prepare("select count(*) as count from documents").get(),
      ).toEqual({ count: documentFixtures.length });
      expect(
        secondConnection
          .prepare("select count(*) as count from lawyers")
          .get(),
      ).toEqual({ count: lawyerFixtures.length });
    } finally {
      secondConnection.close();
    }
  });
});

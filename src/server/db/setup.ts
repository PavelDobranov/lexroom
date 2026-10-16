import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";

import documentFixtures from "../../../samples/documents.json";
import lawyerFixtures from "../../../samples/lawyers.json";
import { openDatabase, resolveDatabasePath } from "./database";

type PublicLawyer = {
  id: string;
  name: string;
  title: string;
};

type PublicDocument = {
  id: string;
  title: string;
  type: string;
  pages: number;
  uploadedAt: string;
  uploadedByLawyerId: string;
  supersedesDocumentId: string | null;
};

const lawyers: PublicLawyer[] = lawyerFixtures.map((lawyer) => ({
  id: lawyer.id,
  name: lawyer.name,
  title: lawyer.title,
}));

// Keep this mapping explicit: findings are private fake-AI input, not database data.
const documents: PublicDocument[] = documentFixtures.map((document) => ({
  id: document.id,
  title: document.title,
  type: document.type,
  pages: document.pages,
  uploadedAt: document.uploadedAt,
  uploadedByLawyerId: document.uploadedBy,
  supersedesDocumentId: document.supersedes,
}));

export class FixtureConflictError extends Error {
  constructor(kind: "lawyer" | "document", id: string) {
    super(
      `Sample ${kind} ${id} conflicts with existing public data; no fixture data was changed.`,
    );
    this.name = "FixtureConflictError";
  }
}

function orderDocumentsBySupersedes(
  fixtures: PublicDocument[],
): PublicDocument[] {
  const byId = new Map(fixtures.map((document) => [document.id, document]));
  const ordered: PublicDocument[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (document: PublicDocument) => {
    if (visited.has(document.id)) return;
    if (visiting.has(document.id)) {
      throw new Error(`Sample document supersedes cycle includes ${document.id}.`);
    }

    visiting.add(document.id);
    const predecessor = document.supersedesDocumentId
      ? byId.get(document.supersedesDocumentId)
      : undefined;
    if (predecessor) visit(predecessor);
    visiting.delete(document.id);
    visited.add(document.id);
    ordered.push(document);
  };

  for (const document of fixtures) visit(document);
  return ordered;
}

function sameLawyer(existing: PublicLawyer, fixture: PublicLawyer): boolean {
  return existing.name === fixture.name && existing.title === fixture.title;
}

function sameDocument(
  existing: PublicDocument,
  fixture: PublicDocument,
): boolean {
  return (
    existing.title === fixture.title &&
    existing.type === fixture.type &&
    existing.pages === fixture.pages &&
    existing.uploadedAt === fixture.uploadedAt &&
    existing.uploadedByLawyerId === fixture.uploadedByLawyerId &&
    existing.supersedesDocumentId === fixture.supersedesDocumentId
  );
}

export function setupDatabase(
  databasePath = resolveDatabasePath(),
  migrationsFolder = path.resolve(process.cwd(), "drizzle"),
): void {
  const sqlite = openDatabase(databasePath, { create: true });

  try {
    migrate(drizzle(sqlite), { migrationsFolder });

    const findLawyer = sqlite.prepare<{ id: string }, PublicLawyer>(
      "select id, name, title from lawyers where id = @id",
    );
    const insertLawyer = sqlite.prepare(
      "insert into lawyers (id, name, title) values (@id, @name, @title)",
    );
    const findDocument = sqlite.prepare<
      { id: string },
      PublicDocument
    >(`
      select
        id,
        title,
        type,
        pages,
        uploaded_at as uploadedAt,
        uploaded_by_lawyer_id as uploadedByLawyerId,
        supersedes_document_id as supersedesDocumentId
      from documents
      where id = @id
    `);
    const insertDocument = sqlite.prepare(`
      insert into documents (
        id,
        title,
        type,
        pages,
        uploaded_at,
        uploaded_by_lawyer_id,
        supersedes_document_id
      ) values (
        @id,
        @title,
        @type,
        @pages,
        @uploadedAt,
        @uploadedByLawyerId,
        @supersedesDocumentId
      )
    `);

    sqlite.transaction(() => {
      for (const lawyer of lawyers) {
        const existing = findLawyer.get({ id: lawyer.id });
        if (!existing) insertLawyer.run(lawyer);
        else if (!sameLawyer(existing, lawyer)) {
          throw new FixtureConflictError("lawyer", lawyer.id);
        }
      }

      for (const document of orderDocumentsBySupersedes(documents)) {
        const existing = findDocument.get({ id: document.id });
        if (!existing) insertDocument.run(document);
        else if (!sameDocument(existing, document)) {
          throw new FixtureConflictError("document", document.id);
        }
      }
    })();
  } finally {
    sqlite.close();
  }
}

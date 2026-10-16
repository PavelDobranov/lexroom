import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const lawyers = sqliteTable(
  "lawyers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    title: text("title").notNull(),
  },
  (table) => [
    check("lawyers_name_non_empty", sql`length(trim(${table.name})) > 0`),
    check("lawyers_title_non_empty", sql`length(trim(${table.title})) > 0`),
  ],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    pages: integer("pages").notNull(),
    uploadedAt: text("uploaded_at").notNull(),
    uploadedByLawyerId: text("uploaded_by_lawyer_id")
      .notNull()
      .references(() => lawyers.id),
    supersedesDocumentId: text("supersedes_document_id").references(
      (): AnySQLiteColumn => documents.id,
    ),
  },
  (table) => [
    check("documents_title_non_empty", sql`length(trim(${table.title})) > 0`),
    check("documents_type_non_empty", sql`length(trim(${table.type})) > 0`),
    check(
      "documents_pages_positive_integer",
      sql`typeof(${table.pages}) = 'integer' and ${table.pages} > 0`,
    ),
    check(
      "documents_uploaded_at_iso_8601_utc",
      sql`${table.uploadedAt} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z' and datetime(${table.uploadedAt}) is not null`,
    ),
  ],
);

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";

// ISO 8601 UTC text, matching the M1 timestamp convention: a whole-second
// "YYYY-MM-DDThh:mm:ssZ" or a fractional-second "…ss.<digits>Z", validated as a
// real instant rather than a well-shaped string.
function isoUtcTimestamp(column: SQLiteColumn): SQL {
  return sql`
    substr(${column}, 1, 19) glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    and unixepoch(${column}) is not null
    and strftime('%Y-%m-%dT%H:%M:%S', unixepoch(${column}), 'unixepoch') = substr(${column}, 1, 19)
    and (
      (length(${column}) = 20 and substr(${column}, 20, 1) = 'Z')
      or (
        length(${column}) > 21
        and substr(${column}, 20, 1) = '.'
        and substr(${column}, -1, 1) = 'Z'
        and substr(${column}, 21, length(${column}) - 21) not glob '*[^0-9]*'
      )
    )
  `;
}

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
      sql`
        substr(${table.uploadedAt}, 1, 19) glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
        and unixepoch(${table.uploadedAt}) is not null
        and strftime('%Y-%m-%dT%H:%M:%S', unixepoch(${table.uploadedAt}), 'unixepoch') = substr(${table.uploadedAt}, 1, 19)
        and (
          (length(${table.uploadedAt}) = 20 and substr(${table.uploadedAt}, 20, 1) = 'Z')
          or (
            length(${table.uploadedAt}) > 21
            and substr(${table.uploadedAt}, 20, 1) = '.'
            and substr(${table.uploadedAt}, -1, 1) = 'Z'
            and substr(${table.uploadedAt}, 21, length(${table.uploadedAt}) - 21) not glob '*[^0-9]*'
          )
        )
      `,
    ),
  ],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    requestedByLawyerId: text("requested_by_lawyer_id")
      .notNull()
      .references(() => lawyers.id),
    requestId: text("request_id").notNull().unique(),
    status: text("status").notNull(),
    allowanceMonth: text("allowance_month").notNull(),
    requestedAt: text("requested_at").notNull(),
    deadlineAt: text("deadline_at").notNull(),
    completedAt: text("completed_at"),
    failedAt: text("failed_at"),
    failureReason: text("failure_reason"),
  },
  (table) => [
    check(
      "reviews_status_enum",
      sql`${table.status} in ('running', 'completed', 'failed')`,
    ),
    check(
      "reviews_failure_reason_enum",
      sql`${table.failureReason} is null or ${table.failureReason} in ('ai_error', 'timed_out', 'interrupted')`,
    ),
    check(
      "reviews_allowance_month_format",
      sql`${table.allowanceMonth} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        and cast(substr(${table.allowanceMonth}, 6, 2) as integer) between 1 and 12`,
    ),
    check("reviews_requested_at_iso_8601_utc", isoUtcTimestamp(table.requestedAt)),
    check("reviews_deadline_at_iso_8601_utc", isoUtcTimestamp(table.deadlineAt)),
    check(
      "reviews_completed_at_iso_8601_utc",
      sql`${table.completedAt} is null or (${isoUtcTimestamp(table.completedAt)})`,
    ),
    check(
      "reviews_failed_at_iso_8601_utc",
      sql`${table.failedAt} is null or (${isoUtcTimestamp(table.failedAt)})`,
    ),
    // Terminal-field consistency only: never the lifecycle transitions or the
    // deadline arithmetic, which ReviewService owns.
    check(
      "reviews_running_has_no_terminal_fields",
      sql`${table.status} != 'running'
        or (${table.completedAt} is null and ${table.failedAt} is null and ${table.failureReason} is null)`,
    ),
    check(
      "reviews_completed_has_completion_only",
      sql`${table.status} != 'completed'
        or (${table.completedAt} is not null and ${table.failedAt} is null and ${table.failureReason} is null)`,
    ),
    check(
      "reviews_failed_has_failure_only",
      sql`${table.status} != 'failed'
        or (${table.failedAt} is not null and ${table.failureReason} is not null and ${table.completedAt} is null)`,
    ),
    uniqueIndex("reviews_one_running_per_document")
      .on(table.documentId)
      .where(sql`${table.status} = 'running'`),
    index("reviews_allowance_month_status").on(
      table.allowanceMonth,
      table.status,
    ),
    index("reviews_document_requested_at").on(
      table.documentId,
      table.requestedAt,
      table.id,
    ),
    index("reviews_document_completed_at")
      .on(table.documentId, table.completedAt, table.id)
      .where(sql`${table.status} = 'completed'`),
  ],
);

export const findings = sqliteTable(
  "findings",
  {
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id),
    position: integer("position").notNull(),
    clause: text("clause"),
    title: text("title").notNull(),
    severity: text("severity").notNull(),
    excerpt: text("excerpt"),
    explanation: text("explanation").notNull(),
    emittedAt: text("emitted_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.reviewId, table.position] }),
    check(
      "findings_position_non_negative_integer",
      sql`typeof(${table.position}) = 'integer' and ${table.position} >= 0`,
    ),
    check(
      "findings_severity_enum",
      sql`${table.severity} in ('low', 'medium', 'high')`,
    ),
    check("findings_emitted_at_iso_8601_utc", isoUtcTimestamp(table.emittedAt)),
  ],
);

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import type {
  FindingSnapshot,
  ReviewBase,
  ReviewFailureReason,
  ReviewSnapshot,
} from "../../shared/api";

export const MONTHLY_REVIEW_LIMIT = 10;
export const REVIEW_DEADLINE_SECONDS = 60;

/** A finding the fake runner emits during a running review. */
export type FindingInput = {
  position: number;
  clause: string | null;
  title: string;
  severity: "low" | "medium" | "high";
  excerpt: string | null;
  explanation: string;
};

export type AdmissionInput = {
  documentId: string;
  requestedByLawyerId: string;
  requestId: string;
};

export type AdmissionResult =
  | { outcome: "created"; review: ReviewSnapshot }
  | { outcome: "replayed"; review: ReviewSnapshot }
  | { outcome: "request_id_conflict" }
  | { outcome: "document_not_found" }
  | { outcome: "lawyer_not_found" }
  | { outcome: "review_already_running" }
  | { outcome: "allowance_exhausted" }
  | { outcome: "allowance_temporarily_reserved" };

type ReviewRow = {
  id: string;
  documentId: string;
  requestedByLawyerId: string;
  requestId: string;
  status: "running" | "completed" | "failed";
  allowanceMonth: string;
  requestedAt: string;
  deadlineAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureReason: ReviewFailureReason | null;
};

const SELECT_REVIEW = `
  select
    id,
    document_id as documentId,
    requested_by_lawyer_id as requestedByLawyerId,
    request_id as requestId,
    status,
    allowance_month as allowanceMonth,
    requested_at as requestedAt,
    deadline_at as deadlineAt,
    completed_at as completedAt,
    failed_at as failedAt,
    failure_reason as failureReason
  from reviews
`;

function toIsoUtc(date: Date): string {
  return date.toISOString();
}

export function utcMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function deadlineFrom(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + REVIEW_DEADLINE_SECONDS * 1000);
}

function reviewBase(row: ReviewRow): ReviewBase {
  return {
    id: row.id,
    documentId: row.documentId,
    requestedByLawyerId: row.requestedByLawyerId,
    requestedAt: row.requestedAt,
    allowanceMonth: row.allowanceMonth,
  };
}

function readFindings(
  sqlite: Database.Database,
  reviewId: string,
): FindingSnapshot[] {
  return sqlite
    .prepare<[string], FindingSnapshot>(`
      select
        position,
        clause,
        title,
        severity,
        excerpt,
        explanation,
        emitted_at as emittedAt
      from findings
      where review_id = ?
      order by position asc
    `)
    .all(reviewId);
}

function snapshotFromRow(
  sqlite: Database.Database,
  row: ReviewRow,
): ReviewSnapshot {
  const base = reviewBase(row);
  if (row.status === "running") {
    return {
      ...base,
      status: "running",
      deadlineAt: row.deadlineAt,
      partialFindings: readFindings(sqlite, row.id),
    };
  }
  if (row.status === "completed") {
    return {
      ...base,
      status: "completed",
      completedAt: row.completedAt!,
      findings: readFindings(sqlite, row.id),
    };
  }
  return {
    ...base,
    status: "failed",
    failedAt: row.failedAt!,
    failureReason: row.failureReason!,
  };
}

function loadRow(
  sqlite: Database.Database,
  reviewId: string,
): ReviewRow | undefined {
  return sqlite
    .prepare<[string], ReviewRow>(`${SELECT_REVIEW} where id = ?`)
    .get(reviewId);
}

/** Builds the authoritative status-discriminated snapshot, or null when unknown. */
export function readReviewSnapshot(
  sqlite: Database.Database,
  reviewId: string,
): ReviewSnapshot | null {
  const row = loadRow(sqlite, reviewId);
  if (!row) return null;
  return snapshotFromRow(sqlite, row);
}

function isUniqueConstraintError(error: unknown, fragment: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code ?? "";
  return (
    code.startsWith("SQLITE_CONSTRAINT") && error.message.includes(fragment)
  );
}

/**
 * ReviewService owns every write to the review lifecycle and finding tables.
 * Each operation runs its own transaction against the supplied connection, and
 * SQLite serialization plus conditional `status = 'running'` updates decide race
 * winners. Routes and the fake runner call these methods; they never write the
 * lifecycle tables directly.
 */
export class ReviewService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly now: () => Date,
  ) {}

  /** Admits a new review, or replays/denies per M2-REQ-6 precedence. */
  admit(input: AdmissionInput): AdmissionResult {
    const admitOnce = this.sqlite.transaction((): AdmissionResult => {
      const requestedAtDate = this.now();
      const requestedAt = toIsoUtc(requestedAtDate);
      const deadlineAt = toIsoUtc(deadlineFrom(requestedAtDate));
      const allowanceMonth = utcMonth(requestedAtDate);

      // 1-2. Idempotent replay / request-id conflict come first.
      const existing = this.sqlite
        .prepare<
          [string],
          ReviewRow
        >(`${SELECT_REVIEW} where request_id = ?`)
        .get(input.requestId);
      if (existing) {
        if (
          existing.documentId === input.documentId &&
          existing.requestedByLawyerId === input.requestedByLawyerId
        ) {
          return {
            outcome: "replayed",
            review: snapshotFromRow(this.sqlite, existing),
          };
        }
        return { outcome: "request_id_conflict" };
      }

      // 3. Reference validation.
      const documentExists = this.sqlite
        .prepare<[string], { id: string }>("select id from documents where id = ?")
        .get(input.documentId);
      if (!documentExists) return { outcome: "document_not_found" };
      const lawyerExists = this.sqlite
        .prepare<[string], { id: string }>("select id from lawyers where id = ?")
        .get(input.requestedByLawyerId);
      if (!lawyerExists) return { outcome: "lawyer_not_found" };

      // 4. One running review per document.
      const running = this.sqlite
        .prepare<
          [string],
          { count: number }
        >("select count(*) as count from reviews where document_id = ? and status = 'running'")
        .get(input.documentId)!;
      if (running.count > 0) return { outcome: "review_already_running" };

      // 5-6. Monthly allowance capacity for the request month.
      const counts = this.sqlite
        .prepare<[string], { completed: number; reserved: number }>(`
          select
            sum(case when status = 'completed' then 1 else 0 end) as completed,
            sum(case when status = 'running' then 1 else 0 end) as reserved
          from reviews
          where allowance_month = ?
        `)
        .get(allowanceMonth)!;
      const completed = counts.completed ?? 0;
      const reserved = counts.reserved ?? 0;
      if (completed >= MONTHLY_REVIEW_LIMIT) {
        return { outcome: "allowance_exhausted" };
      }
      if (completed + reserved >= MONTHLY_REVIEW_LIMIT) {
        return { outcome: "allowance_temporarily_reserved" };
      }

      // 7. Create the running review.
      const id = randomUUID();
      try {
        this.sqlite
          .prepare(`
            insert into reviews (
              id, document_id, requested_by_lawyer_id, request_id,
              status, allowance_month, requested_at, deadline_at
            ) values (?, ?, ?, ?, 'running', ?, ?, ?)
          `)
          .run(
            id,
            input.documentId,
            input.requestedByLawyerId,
            input.requestId,
            allowanceMonth,
            requestedAt,
            deadlineAt,
          );
      } catch (error) {
        // Defensive: the partial unique index independently enforces one running
        // review per document even if a competing writer slipped past the check.
        if (
          isUniqueConstraintError(error, "reviews_one_running_per_document")
        ) {
          return { outcome: "review_already_running" };
        }
        throw error;
      }

      return {
        outcome: "created",
        review: snapshotFromRow(this.sqlite, loadRow(this.sqlite, id)!),
      };
    });

    return admitOnce.immediate();
  }

  /**
   * Persists one preliminary finding for a running review. Duplicate
   * `(reviewId, position)` emission is idempotent; emission after a terminal
   * status or the deadline is a safe no-op.
   */
  emitFinding(reviewId: string, finding: FindingInput): ReviewSnapshot | null {
    const emit = this.sqlite.transaction((): ReviewSnapshot | null => {
      const row = loadRow(this.sqlite, reviewId);
      if (!row) return null;
      if (!this.isRunningBeforeDeadline(row)) {
        return snapshotFromRow(this.sqlite, row);
      }
      this.sqlite
        .prepare(`
          insert or ignore into findings (
            review_id, position, clause, title, severity, excerpt, explanation, emitted_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          reviewId,
          finding.position,
          finding.clause,
          finding.title,
          finding.severity,
          finding.excerpt,
          finding.explanation,
          toIsoUtc(this.now()),
        );
      return snapshotFromRow(this.sqlite, loadRow(this.sqlite, reviewId)!);
    });
    return emit.immediate();
  }

  /** Completes a running review before its deadline; later callbacks no-op. */
  complete(reviewId: string): ReviewSnapshot | null {
    const finish = this.sqlite.transaction((): ReviewSnapshot | null => {
      const row = loadRow(this.sqlite, reviewId);
      if (!row) return null;
      if (!this.isRunningBeforeDeadline(row)) {
        return snapshotFromRow(this.sqlite, row);
      }
      this.sqlite
        .prepare(`
          update reviews
          set status = 'completed', completed_at = ?
          where id = ? and status = 'running'
        `)
        .run(toIsoUtc(this.now()), reviewId);
      return snapshotFromRow(this.sqlite, loadRow(this.sqlite, reviewId)!);
    });
    return finish.immediate();
  }

  /**
   * Fails a running review with a structured reason and releases its
   * reservation. Used when an accepted review cannot be launched (M2-REQ-7).
   */
  fail(
    reviewId: string,
    reason: ReviewFailureReason,
  ): ReviewSnapshot | null {
    const markFailed = this.sqlite.transaction((): ReviewSnapshot | null => {
      const row = loadRow(this.sqlite, reviewId);
      if (!row) return null;
      if (row.status !== "running") {
        return snapshotFromRow(this.sqlite, row);
      }
      this.sqlite
        .prepare(`
          update reviews
          set status = 'failed', failed_at = ?, failure_reason = ?
          where id = ? and status = 'running'
        `)
        .run(toIsoUtc(this.now()), reason, reviewId);
      return snapshotFromRow(this.sqlite, loadRow(this.sqlite, reviewId)!);
    });
    return markFailed.immediate();
  }

  private isRunningBeforeDeadline(row: ReviewRow): boolean {
    if (row.status !== "running") return false;
    return this.now().getTime() < new Date(row.deadlineAt).getTime();
  }
}

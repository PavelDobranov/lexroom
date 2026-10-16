import type Database from "better-sqlite3";

import type {
  CompletedReviewSummary,
  ReviewFailureReason,
  ReviewSummary,
  WorkspaceSnapshot,
} from "../../shared/api";
import {
  MONTHLY_REVIEW_LIMIT,
  ReviewService,
  utcMonth,
} from "../reviews/review-service";

type PersistedDocument = {
  id: string;
  title: string;
  type: string;
  pages: number;
  uploadedAt: string;
  uploadedByLawyerId: string;
  supersedesDocumentId: string | null;
};

type ReviewSummaryRow = {
  id: string;
  documentId: string;
  requestedByLawyerId: string;
  requestedAt: string;
  allowanceMonth: string;
  status: "running" | "completed" | "failed";
  deadlineAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureReason: ReviewFailureReason | null;
  findingCount: number;
};

function compareUploadedAtNewestFirst(
  left: PersistedDocument,
  right: PersistedDocument,
): number {
  const leftSecond = left.uploadedAt.slice(0, 19);
  const rightSecond = right.uploadedAt.slice(0, 19);
  if (leftSecond !== rightSecond) return leftSecond < rightSecond ? 1 : -1;

  const fraction = (timestamp: string) =>
    timestamp[19] === "." ? timestamp.slice(20, -1) : "";
  const leftFraction = fraction(left.uploadedAt).replace(/0+$/, "");
  const rightFraction = fraction(right.uploadedAt).replace(/0+$/, "");
  const precision = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(precision, "0");
  const normalizedRight = rightFraction.padEnd(precision, "0");
  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft < normalizedRight ? 1 : -1;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function toSummary(row: ReviewSummaryRow): ReviewSummary {
  const base = {
    id: row.id,
    documentId: row.documentId,
    requestedByLawyerId: row.requestedByLawyerId,
    requestedAt: row.requestedAt,
    allowanceMonth: row.allowanceMonth,
  };
  if (row.status === "running") {
    return {
      ...base,
      status: "running",
      deadlineAt: row.deadlineAt,
      emittedFindingCount: row.findingCount,
    };
  }
  if (row.status === "completed") {
    return {
      ...base,
      status: "completed",
      completedAt: row.completedAt!,
      findingCount: row.findingCount,
    };
  }
  return {
    ...base,
    status: "failed",
    failedAt: row.failedAt!,
    failureReason: row.failureReason!,
  };
}

/** Newest `requestedAt` wins, with the greater review ID as a deterministic tie-breaker. */
export function selectLatestAttempt(
  summaries: ReviewSummary[],
): ReviewSummary | null {
  let best: ReviewSummary | null = null;
  for (const summary of summaries) {
    if (best === null || isNewer(summary.requestedAt, summary.id, best.requestedAt, best.id)) {
      best = summary;
    }
  }
  return best;
}

/** Newest `completedAt` wins among completed reviews, tie-broken by greater review ID. */
export function selectLatestSuccessful(
  summaries: ReviewSummary[],
): CompletedReviewSummary | null {
  let best: CompletedReviewSummary | null = null;
  for (const summary of summaries) {
    if (summary.status !== "completed") continue;
    if (
      best === null ||
      isNewer(summary.completedAt, summary.id, best.completedAt, best.id)
    ) {
      best = summary;
    }
  }
  return best;
}

function isNewer(
  candidateTime: string,
  candidateId: string,
  bestTime: string,
  bestId: string,
): boolean {
  const candidate = new Date(candidateTime).getTime();
  const best = new Date(bestTime).getTime();
  if (candidate !== best) return candidate > best;
  return candidateId > bestId;
}

export function readWorkspaceSnapshot(
  sqlite: Database.Database,
  now: Date,
): WorkspaceSnapshot {
  new ReviewService(sqlite, () => now).expireOverdueReviews();

  const lawyers = sqlite
    .prepare<
      [],
      WorkspaceSnapshot["lawyers"][number]
    >("select id, name, title from lawyers order by name asc, id asc")
    .all();
  const persistedDocuments = sqlite
    .prepare<[], PersistedDocument>(`
      select
        id,
        title,
        type,
        pages,
        uploaded_at as uploadedAt,
        uploaded_by_lawyer_id as uploadedByLawyerId,
        supersedes_document_id as supersedesDocumentId
      from documents
    `)
    .all()
    .sort(compareUploadedAtNewestFirst);

  const summariesByDocument = new Map<string, ReviewSummary[]>();
  for (const row of sqlite
    .prepare<[], ReviewSummaryRow>(`
      select
        r.id,
        r.document_id as documentId,
        r.requested_by_lawyer_id as requestedByLawyerId,
        r.requested_at as requestedAt,
        r.allowance_month as allowanceMonth,
        r.status,
        r.deadline_at as deadlineAt,
        r.completed_at as completedAt,
        r.failed_at as failedAt,
        r.failure_reason as failureReason,
        (select count(*) from findings f where f.review_id = r.id) as findingCount
      from reviews r
    `)
    .all()) {
    const summary = toSummary(row);
    const existing = summariesByDocument.get(row.documentId);
    if (existing) existing.push(summary);
    else summariesByDocument.set(row.documentId, [summary]);
  }

  const month = utcMonth(now);
  const allowance = sqlite
    .prepare<[string], { completed: number; reserved: number }>(`
      select
        sum(case when status = 'completed' then 1 else 0 end) as completed,
        sum(case when status = 'running' then 1 else 0 end) as reserved
      from reviews
      where allowance_month = ?
    `)
    .get(month)!;
  const completed = allowance.completed ?? 0;
  const reserved = allowance.reserved ?? 0;

  return {
    lawyers,
    documents: persistedDocuments.map((document) => {
      const summaries = summariesByDocument.get(document.id) ?? [];
      return {
        ...document,
        latestReviewAttempt: selectLatestAttempt(summaries),
        latestSuccessfulReview: selectLatestSuccessful(summaries),
      };
    }),
    monthlyAllowance: {
      month,
      limit: MONTHLY_REVIEW_LIMIT,
      completed,
      reserved,
      available: Math.max(0, MONTHLY_REVIEW_LIMIT - completed - reserved),
    },
  };
}

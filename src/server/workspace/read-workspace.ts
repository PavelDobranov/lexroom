import type Database from "better-sqlite3";

import type { WorkspaceSnapshot } from "../../shared/api";

const MONTHLY_REVIEW_LIMIT = 10;

type PersistedDocument = Omit<
  WorkspaceSnapshot["documents"][number],
  "latestReviewAttempt" | "latestSuccessfulReview"
>;

function utcMonth(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

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

export function readWorkspaceSnapshot(
  sqlite: Database.Database,
  now: Date,
): WorkspaceSnapshot {
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

  return {
    lawyers,
    documents: persistedDocuments.map((document) => ({
      ...document,
      latestReviewAttempt: null,
      latestSuccessfulReview: null,
    })),
    monthlyAllowance: {
      month: utcMonth(now),
      limit: MONTHLY_REVIEW_LIMIT,
      completed: 0,
      reserved: 0,
      available: MONTHLY_REVIEW_LIMIT,
    },
  };
}

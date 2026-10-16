import type {
  DocumentReviewFields,
  FindingSnapshot,
  ReviewFailureReason,
  ReviewSnapshot,
  ReviewSummary,
  WorkspaceSnapshot,
} from "../shared/api";

export type ReviewActionLabel =
  | "Request review"
  | "Review again"
  | "Review in progress";

/** Selects only the full snapshots needed for an opened Document. */
export function reviewIdsToOpen(
  reviews: DocumentReviewFields,
  preferredLatestReviewId?: string,
): { latestReviewId: string | null; previousSuccessfulReviewId: string | null } {
  const latestReviewId =
    preferredLatestReviewId ?? reviews.latestReviewAttempt?.id ?? null;
  const successfulReviewId = reviews.latestSuccessfulReview?.id ?? null;
  return {
    latestReviewId,
    previousSuccessfulReviewId:
      successfulReviewId === latestReviewId ? null : successfulReviewId,
  };
}

/** The per-document action label from its latest review attempt (M2-REQ-11). */
export function reviewActionLabel(
  latestAttempt: ReviewSummary | null,
): ReviewActionLabel {
  if (!latestAttempt) return "Request review";
  if (latestAttempt.status === "running") return "Review in progress";
  return "Review again";
}

export type AllowanceAvailability =
  | { canRequest: true; reason: null }
  | {
      canRequest: false;
      reason: "exhausted" | "temporarily_reserved";
      message: string;
    };

/**
 * Describes whether a new request is allowed from the visible snapshot, and the
 * distinct reason when it is not (M2-REQ-11). The server stays authoritative.
 */
export function describeAllowanceAvailability(
  allowance: WorkspaceSnapshot["monthlyAllowance"],
): AllowanceAvailability {
  if (allowance.available > 0) return { canRequest: true, reason: null };
  if (allowance.completed >= allowance.limit) {
    return {
      canRequest: false,
      reason: "exhausted",
      message:
        "All ten reviews for this month have completed. Capacity returns next month (UTC).",
    };
  }
  return {
    canRequest: false,
    reason: "temporarily_reserved",
    message:
      "The allowance is fully reserved by running reviews. Capacity may return if a running review fails.",
  };
}

export const REVIEW_FAILURE_MESSAGES: Record<ReviewFailureReason, string> = {
  ai_error: "The review failed. Please try again.",
  timed_out: "The review timed out after 60 seconds.",
  interrupted: "The review was interrupted and was not resumed.",
};

export type ReviewPresentation =
  | { kind: "running"; findings: FindingSnapshot[] }
  | { kind: "completed-empty" }
  | { kind: "completed"; findings: FindingSnapshot[] }
  | { kind: "failed"; failureReason: ReviewFailureReason; message: string };

/**
 * Maps an authoritative snapshot to a safe presentation. Running findings are
 * preliminary, a completed empty review is "No issues flagged", and failed
 * reviews never expose partial findings (M2-REQ-12).
 */
export function resolveReviewPresentation(
  snapshot: ReviewSnapshot,
): ReviewPresentation {
  if (snapshot.status === "running") {
    return { kind: "running", findings: snapshot.partialFindings };
  }
  if (snapshot.status === "completed") {
    return snapshot.findings.length === 0
      ? { kind: "completed-empty" }
      : { kind: "completed", findings: snapshot.findings };
  }
  return {
    kind: "failed",
    failureReason: snapshot.failureReason,
    message: REVIEW_FAILURE_MESSAGES[snapshot.failureReason],
  };
}

export function isTerminalStatus(status: ReviewSnapshot["status"]): boolean {
  return status === "completed" || status === "failed";
}

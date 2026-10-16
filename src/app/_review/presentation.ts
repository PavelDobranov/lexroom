import type {
  DocumentReviewFields,
  FindingSnapshot,
  ReviewFailureReason,
  ReviewSnapshot,
  ReviewSummary,
  WorkspaceSnapshot,
} from "../../shared/api";

export type ReviewActionLabel =
  | "Request review"
  | "Review again"
  | "Review in progress";

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


export function reviewActionLabel(
  latestAttempt: ReviewSummary | null,
): ReviewActionLabel {
  if (!latestAttempt) {
    return "Request review";
  }

  if (latestAttempt.status === "running") {
    return "Review in progress";
  }

  return "Review again";
}

export type AllowanceAvailability =
  | { canRequest: true; reason: null }
  | {
    canRequest: false;
    reason: "exhausted" | "temporarily_reserved";
    message: string;
  };


export function describeAllowanceAvailability(
  allowance: WorkspaceSnapshot["monthlyAllowance"],
): AllowanceAvailability {
  if (allowance.available > 0) {
    return { canRequest: true, reason: null };
  }

  if (allowance.completed >= allowance.limit) {
    return {
      canRequest: false,
      reason: "exhausted",
      message: `All ${allowance.limit} reviews for this month have completed. Capacity returns next month (UTC).`,
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

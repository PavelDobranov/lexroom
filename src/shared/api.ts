export type ReviewStatus = "running" | "completed" | "failed";

export type ReviewFailureReason = "ai_error" | "timed_out" | "interrupted";

export type FindingSnapshot = {
  position: number; // non-negative source order; responses sort ascending
  clause: string | null;
  title: string;
  severity: "low" | "medium" | "high";
  excerpt: string | null;
  explanation: string;
  emittedAt: string; // ISO 8601 UTC
};

export type ReviewBase = {
  id: string;
  documentId: string;
  requestedByLawyerId: string;
  requestedAt: string;
  allowanceMonth: string; // YYYY-MM
};

export type ReviewSnapshot =
  | (ReviewBase & {
      status: "running";
      deadlineAt: string;
      partialFindings: FindingSnapshot[];
    })
  | (ReviewBase & {
      status: "completed";
      completedAt: string;
      findings: FindingSnapshot[];
    })
  | (ReviewBase & {
      status: "failed";
      failedAt: string;
      failureReason: ReviewFailureReason;
    });

export type ReviewSummary =
  | (ReviewBase & {
      status: "running";
      deadlineAt: string;
      emittedFindingCount: number;
    })
  | (ReviewBase & {
      status: "completed";
      completedAt: string;
      findingCount: number;
    })
  | (ReviewBase & {
      status: "failed";
      failedAt: string;
      failureReason: ReviewFailureReason;
    });

export type CompletedReviewSummary = Extract<
  ReviewSummary,
  { status: "completed" }
>;

export type DocumentReviewFields = {
  latestReviewAttempt: ReviewSummary | null;
  latestSuccessfulReview: CompletedReviewSummary | null;
};

export type WorkspaceSnapshot = {
  lawyers: Array<{
    id: string;
    name: string;
    title: string;
  }>;
  documents: Array<
    {
      id: string;
      title: string;
      type: string;
      pages: number;
      uploadedAt: string;
      uploadedByLawyerId: string;
      supersedesDocumentId: string | null;
    } & DocumentReviewFields
  >;
  monthlyAllowance: {
    month: string;
    limit: number;
    completed: number;
    reserved: number;
    available: number;
  };
};

export type CreateReviewRequest = {
  requestedByLawyerId: string;
  requestId: string; // UUID
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

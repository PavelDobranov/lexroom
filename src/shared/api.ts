export type WorkspaceSnapshot = {
  lawyers: Array<{
    id: string;
    name: string;
    title: string;
  }>;
  documents: Array<{
    id: string;
    title: string;
    type: string;
    pages: number;
    uploadedAt: string;
    uploadedByLawyerId: string;
    supersedesDocumentId: string | null;
    latestReviewAttempt: null;
    latestSuccessfulReview: null;
  }>;
  monthlyAllowance: {
    month: string;
    limit: number;
    completed: number;
    reserved: number;
    available: number;
  };
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

import type { ApiError, ReviewSnapshot } from "../../shared/api";

export class ReviewApiError extends Error {
  readonly code: string | null;
  readonly status: number | null;

  constructor(message: string, code: string | null, status: number | null) {
    super(message);
    this.name = "ReviewApiError";
    this.code = code;
    this.status = status;
  }
}

export { ReviewApiError as ReviewRequestError };

async function readApiError(
  response: Response,
  fallback: string,
): Promise<ReviewApiError> {
  let message = fallback;
  let code: string | null = null;

  try {
    const body = (await response.json()) as ApiError;

    if (body.error?.message) {
      message = body.error.message;
    }

    if (body.error?.code) {
      code = body.error.code;
    }
  } catch {
    // Keep the safe fallback when the server does not return JSON.
  }

  return new ReviewApiError(message, code, response.status);
}

export async function fetchReview(reviewId: string): Promise<ReviewSnapshot> {
  const response = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw await readApiError(response, "The review could not be loaded.");
  }

  return (await response.json()) as ReviewSnapshot;
}

export type SendReviewRequestInput = {
  documentId: string;
  requestedByLawyerId: string;
  requestId: string;
};

export type RequestReviewInput = SendReviewRequestInput;

export async function requestReview(
  input: SendReviewRequestInput,
): Promise<ReviewSnapshot> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(input.documentId)}/reviews`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestedByLawyerId: input.requestedByLawyerId,
        requestId: input.requestId,
      }),
    },
  );

  if (!response.ok) {
    throw await readApiError(response, "The review could not be requested.");
  }

  return (await response.json()) as ReviewSnapshot;
}

import type { Query } from "@tanstack/react-query";

import type { ApiError, ReviewSnapshot } from "../shared/api";

export const REVIEW_POLL_INTERVAL_MS = 1_000;

export function reviewQueryKey(reviewId: string) {
  return ["review", reviewId] as const;
}

export class ReviewRequestError extends Error {
  readonly code: string | null;
  readonly status: number | null;

  constructor(message: string, code: string | null, status: number | null) {
    super(message);
    this.name = "ReviewRequestError";
    this.code = code;
    this.status = status;
  }
}

async function readApiError(
  response: Response,
  fallback: string,
): Promise<ReviewRequestError> {
  let message = fallback;
  let code: string | null = null;
  try {
    const body = (await response.json()) as ApiError;
    if (body.error?.message) message = body.error.message;
    if (body.error?.code) code = body.error.code;
  } catch {
    // Keep the safe fallback when the server does not return JSON.
  }
  return new ReviewRequestError(message, code, response.status);
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

export type RequestReviewInput = {
  documentId: string;
  requestedByLawyerId: string;
  requestId: string;
};

export async function requestReview(
  input: RequestReviewInput,
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

type ReviewIntent = Omit<RequestReviewInput, "requestId">;

type ReviewRequestCoordinatorOptions = {
  createRequestId?: () => string;
  send?: (input: RequestReviewInput) => Promise<ReviewSnapshot>;
};

/**
 * Keeps the idempotency key for an ambiguously answered submission outside the
 * confirmation dialog lifecycle. Success and definitive 4xx outcomes clear the
 * key; network and 5xx failures retain it for a safe replay.
 */
export function createReviewRequestCoordinator(
  options: ReviewRequestCoordinatorOptions = {},
) {
  const createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  const send = options.send ?? requestReview;
  const unresolvedByIntent = new Map<string, string>();
  const keyFor = (input: ReviewIntent) =>
    `${input.documentId}\u0000${input.requestedByLawyerId}`;

  return {
    async submit(input: ReviewIntent): Promise<ReviewSnapshot> {
      const key = keyFor(input);
      const requestId = unresolvedByIntent.get(key) ?? createRequestId();
      unresolvedByIntent.set(key, requestId);

      try {
        const review = await send({ ...input, requestId });
        if (unresolvedByIntent.get(key) === requestId) {
          unresolvedByIntent.delete(key);
        }
        return review;
      } catch (error) {
        const status = error instanceof ReviewRequestError ? error.status : null;
        if (status !== null && status < 500) {
          if (unresolvedByIntent.get(key) === requestId) {
            unresolvedByIntent.delete(key);
          }
        }
        throw error;
      }
    },
    unresolvedRequestId(input: ReviewIntent): string | null {
      return unresolvedByIntent.get(keyFor(input)) ?? null;
    },
  };
}

const reviewRequestCoordinator = createReviewRequestCoordinator();

export function submitReviewRequest(input: ReviewIntent): Promise<ReviewSnapshot> {
  return reviewRequestCoordinator.submit(input);
}

/**
 * Query options for one review. An actively viewed running review polls every
 * second and stops at a terminal status; interval polling pauses in background
 * tabs and refetches on focus (M2-REQ-13).
 */
export function reviewQueryOptions(reviewId: string, options: { enabled: boolean }) {
  return {
    queryKey: reviewQueryKey(reviewId),
    queryFn: () => fetchReview(reviewId),
    enabled: options.enabled,
    refetchInterval: (query: Query<ReviewSnapshot>) =>
      query.state.data?.status === "running" ? REVIEW_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: 1,
  } as const;
}

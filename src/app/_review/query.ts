import { skipToken, type Query } from "@tanstack/react-query";

import type { ReviewSnapshot } from "../../shared/api";
import { fetchReview } from "./api";

export { fetchReview };
export {
  requestReview,
  ReviewApiError,
  ReviewRequestError,
  type RequestReviewInput,
  type SendReviewRequestInput,
} from "./api";
export {
  createReviewRequestCoordinator,
  submitReviewRequest,
  type SubmitReviewIntent,
} from "./request-coordinator";

export const REVIEW_POLL_INTERVAL_MS = 1_000;

export function reviewQueryKey(reviewId: string | null) {
  return ["review", reviewId] as const;
}

export function reviewQueryOptions(
  reviewId: string | null,
  options?: { enabled: boolean },
) {
  const enabled = reviewId !== null && (options?.enabled ?? true);

  return {
    queryKey: reviewQueryKey(reviewId),
    queryFn: reviewId === null ? skipToken : () => fetchReview(reviewId),
    enabled,
    refetchInterval: (query: Query<ReviewSnapshot>) =>
      query.state.data?.status === "running" ? REVIEW_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: 1,
  } as const;
}

import type { ReviewSnapshot } from "../../shared/api";
import {
  requestReview,
  ReviewApiError,
  type SendReviewRequestInput,
} from "./api";

export type SubmitReviewIntent = Omit<SendReviewRequestInput, "requestId"> & {
  baselineLatestReviewId: string | null;
};

type ReviewRequestCoordinatorOptions = {
  createRequestId?: () => string;
  send?: (input: SendReviewRequestInput) => Promise<ReviewSnapshot>;
};

export function createReviewRequestCoordinator(
  options: ReviewRequestCoordinatorOptions = {},
) {
  const createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
  const send = options.send ?? requestReview;
  const unresolvedByIntent = new Map<
    string,
    { requestId: string; baselineLatestReviewId: string | null }
  >();
  const keyFor = (input: SubmitReviewIntent) =>
    `${input.documentId}\u0000${input.requestedByLawyerId}`;

  async function submit(input: SubmitReviewIntent): Promise<ReviewSnapshot> {
    const key = keyFor(input);
    const existing = unresolvedByIntent.get(key);
    const requestId = existing?.requestId ?? createRequestId();

    unresolvedByIntent.set(
      key,
      existing ?? {
        requestId,
        baselineLatestReviewId: input.baselineLatestReviewId,
      },
    );

    try {
      const review = await send({
        documentId: input.documentId,
        requestedByLawyerId: input.requestedByLawyerId,
        requestId,
      });

      if (unresolvedByIntent.get(key)?.requestId === requestId) {
        unresolvedByIntent.delete(key);
      }

      if (
        existing &&
        input.baselineLatestReviewId !== existing.baselineLatestReviewId &&
        review.status !== "running"
      ) {
        return submit(input);
      }

      return review;
    } catch (error) {
      const status = error instanceof ReviewApiError ? error.status : null;

      if (status !== null && status < 500) {
        if (unresolvedByIntent.get(key)?.requestId === requestId) {
          unresolvedByIntent.delete(key);
        }
      }

      throw error;
    }
  }

  return {
    submit,
    unresolvedRequestId(input: SubmitReviewIntent): string | null {
      return unresolvedByIntent.get(keyFor(input))?.requestId ?? null;
    },
  };
}

const reviewRequestCoordinator = createReviewRequestCoordinator();

export function submitReviewRequest(
  input: SubmitReviewIntent,
): Promise<ReviewSnapshot> {
  return reviewRequestCoordinator.submit(input);
}

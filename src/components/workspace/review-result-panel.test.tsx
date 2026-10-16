import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ReviewSnapshot } from "../../shared/api";
import { reviewQueryKey } from "../../lib/review-query";
import { ReviewResultPanel } from "./review-result-panel";

const base = {
  documentId: "doc-1",
  requestedByLawyerId: "lawyer-1",
  allowanceMonth: "2026-10",
};

function renderPanel(
  latest: ReviewSnapshot,
  previous: ReviewSnapshot | null = null,
): string {
  const queryClient = new QueryClient();
  queryClient.setQueryData(reviewQueryKey(latest.id), latest);
  if (previous) queryClient.setQueryData(reviewQueryKey(previous.id), previous);

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ReviewResultPanel
        latestReviewId={latest.id}
        latestSuccessfulReviewId={previous?.id ?? null}
        onClose={() => undefined}
        onRetry={() => undefined}
      />
    </QueryClientProvider>,
  );
}

const previousSuccess: ReviewSnapshot = {
  ...base,
  id: "review-1",
  requestedAt: "2026-10-16T10:00:00.000Z",
  status: "completed",
  completedAt: "2026-10-16T10:00:30.000Z",
  findings: [],
};

describe("ReviewResultPanel", () => {
  it("separates preliminary findings from the previous completed review", () => {
    const markup = renderPanel(
      {
        ...base,
        id: "review-2",
        requestedAt: "2026-10-16T11:00:00.000Z",
        status: "running",
        deadlineAt: "2026-10-16T11:01:00.000Z",
        partialFindings: [],
      },
      previousSuccess,
    );

    expect(markup).toContain("Review in progress — preliminary findings");
    expect(markup).toContain("Not final");
    expect(markup).toContain("Previous completed review.");
    expect(markup).toContain("No issues flagged.");
  });

  it("shows a failed retry separately from the previous completed review", () => {
    const markup = renderPanel(
      {
        ...base,
        id: "review-2",
        requestedAt: "2026-10-16T11:00:00.000Z",
        status: "failed",
        failedAt: "2026-10-16T11:00:20.000Z",
        failureReason: "ai_error",
      },
      previousSuccess,
    );

    expect(markup).toContain("The review failed. Please try again.");
    expect(markup).toContain("Review again");
    expect(markup).toContain("Previous completed review.");
    expect(markup).not.toContain("preliminary findings");
  });

  it("does not present a cached running snapshot as a previous completion", () => {
    const markup = renderPanel(
      {
        ...base,
        id: "review-2",
        requestedAt: "2026-10-16T11:00:00.000Z",
        status: "failed",
        failedAt: "2026-10-16T11:00:20.000Z",
        failureReason: "ai_error",
      },
      {
        ...base,
        id: "review-1",
        requestedAt: "2026-10-16T10:00:00.000Z",
        status: "running",
        deadlineAt: "2026-10-16T10:01:00.000Z",
        partialFindings: [
          {
            position: 0,
            clause: null,
            title: "Cached preliminary finding",
            severity: "high",
            excerpt: null,
            explanation: "This must not be shown as completed.",
            emittedAt: "2026-10-16T10:00:10.000Z",
          },
        ],
      },
    );

    expect(markup).toContain("Previous completed review.");
    expect(markup).toContain("Loading the completed review…");
    expect(markup).not.toContain("Cached preliminary finding");
    expect(markup).not.toContain("This must not be shown as completed.");
  });

  it("renders one empty completed result without a duplicate previous section", () => {
    const markup = renderPanel(previousSuccess);

    expect(markup).toContain("No issues flagged.");
    expect(markup).not.toContain("Previous completed review.");
  });
});

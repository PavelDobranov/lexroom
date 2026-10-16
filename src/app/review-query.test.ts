import type { Query } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReviewSnapshot } from "../shared/api";
import {
  fetchReview,
  requestReview,
  ReviewRequestError,
  REVIEW_POLL_INTERVAL_MS,
  reviewQueryKey,
  reviewQueryOptions,
} from "./review-query";

const runningSnapshot: ReviewSnapshot = {
  id: "review-1",
  documentId: "doc-1",
  requestedByLawyerId: "lawyer-1",
  requestedAt: "2026-10-16T12:00:00.000Z",
  allowanceMonth: "2026-10",
  status: "running",
  deadlineAt: "2026-10-16T12:01:00.000Z",
  partialFindings: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchReview", () => {
  it("requests the review without HTTP caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(runningSnapshot), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchReview("review-1")).resolves.toEqual(runningSnapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/reviews/review-1", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("surfaces the safe API error code and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "REVIEW_NOT_FOUND", message: "The review was not found." },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await fetchReview("missing").catch((reason) => reason);
    expect(error).toBeInstanceOf(ReviewRequestError);
    expect(error.code).toBe("REVIEW_NOT_FOUND");
    expect(error.status).toBe(404);
  });
});

describe("requestReview", () => {
  it("posts the create request body and returns the snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(runningSnapshot), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestReview({
        documentId: "doc-1",
        requestedByLawyerId: "lawyer-1",
        requestId: "11111111-1111-1111-1111-111111111111",
      }),
    ).resolves.toEqual(runningSnapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/doc-1/reviews", {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        requestedByLawyerId: "lawyer-1",
        requestId: "11111111-1111-1111-1111-111111111111",
      }),
    });
  });

  it("throws a typed error carrying the conflict code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "REVIEW_ALREADY_RUNNING",
              message: "A review is already running for this document.",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await requestReview({
      documentId: "doc-1",
      requestedByLawyerId: "lawyer-1",
      requestId: "11111111-1111-1111-1111-111111111111",
    }).catch((reason) => reason);
    expect(error).toBeInstanceOf(ReviewRequestError);
    expect(error.code).toBe("REVIEW_ALREADY_RUNNING");
  });
});

describe("reviewQueryOptions", () => {
  const queryWith = (data: ReviewSnapshot | undefined) =>
    ({ state: { data } }) as unknown as Query<ReviewSnapshot>;

  it("polls a running review every second and stops at a terminal status", () => {
    expect(REVIEW_POLL_INTERVAL_MS).toBe(1_000);
    const options = reviewQueryOptions("review-1", { enabled: true });

    expect(options.queryKey).toEqual(reviewQueryKey("review-1"));
    expect(options.enabled).toBe(true);
    expect(options.refetchIntervalInBackground).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.staleTime).toBe(0);

    expect(options.refetchInterval(queryWith(runningSnapshot))).toBe(1_000);
    expect(
      options.refetchInterval(
        queryWith({
          ...runningSnapshot,
          status: "completed",
          completedAt: "2026-10-16T12:00:30.000Z",
          findings: [],
        } as ReviewSnapshot),
      ),
    ).toBe(false);
    expect(options.refetchInterval(queryWith(undefined))).toBe(false);
  });

  it("respects the enabled flag", () => {
    expect(reviewQueryOptions("review-1", { enabled: false }).enabled).toBe(false);
  });
});

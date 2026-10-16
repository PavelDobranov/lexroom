import { describe, expect, it } from "vitest";

import type { ReviewSummary } from "../../shared/api";
import { selectLatestAttempt, selectLatestSuccessful } from "./read-workspace";

const base = {
  documentId: "doc-1",
  requestedByLawyerId: "lawyer-1",
  allowanceMonth: "2026-10",
};

function completed(
  id: string,
  requestedAt: string,
  completedAt: string,
  findingCount = 0,
): ReviewSummary {
  return {
    ...base,
    id,
    requestedAt,
    status: "completed",
    completedAt,
    findingCount,
  };
}

const priorSuccess = completed(
  "review-1",
  "2026-10-16T10:00:00.000Z",
  "2026-10-16T10:00:30.000Z",
);

function latestIds(summaries: ReviewSummary[]) {
  return {
    attempt: selectLatestAttempt(summaries)?.id ?? null,
    success: selectLatestSuccessful(summaries)?.id ?? null,
  };
}

describe("workspace review summary selection", () => {
  it("uses one completed zero-Finding review as both latest values", () => {
    expect(latestIds([priorSuccess])).toEqual({
      attempt: "review-1",
      success: "review-1",
    });
    expect(priorSuccess).toMatchObject({ findingCount: 0 });
  });

  it("retains the prior success while a newer review is running", () => {
    const running: ReviewSummary = {
      ...base,
      id: "review-2",
      requestedAt: "2026-10-16T11:00:00.000Z",
      status: "running",
      deadlineAt: "2026-10-16T11:01:00.000Z",
      emittedFindingCount: 2,
    };

    expect(latestIds([priorSuccess, running])).toEqual({
      attempt: "review-2",
      success: "review-1",
    });
  });

  it("retains the prior success while a newer review is failed", () => {
    const failed: ReviewSummary = {
      ...base,
      id: "review-2",
      requestedAt: "2026-10-16T11:00:00.000Z",
      status: "failed",
      failedAt: "2026-10-16T11:00:20.000Z",
      failureReason: "ai_error",
    };

    expect(latestIds([priorSuccess, failed])).toEqual({
      attempt: "review-2",
      success: "review-1",
    });
    expect(failed).not.toHaveProperty("findings");
    expect(failed).not.toHaveProperty("partialFindings");
  });

  it("uses a newer completion as both latest values", () => {
    const latestSuccess = completed(
      "review-2",
      "2026-10-16T11:00:00.000Z",
      "2026-10-16T11:00:30.000Z",
      3,
    );

    expect(latestIds([priorSuccess, latestSuccess])).toEqual({
      attempt: "review-2",
      success: "review-2",
    });
  });

  it("uses the greater review ID to break requestedAt and completedAt ties", () => {
    const lower = completed(
      "review-a",
      "2026-10-16T12:00:00.000Z",
      "2026-10-16T12:00:30.000Z",
    );
    const greater = completed(
      "review-b",
      "2026-10-16T12:00:00.000Z",
      "2026-10-16T12:00:30.000Z",
    );

    expect(latestIds([greater, lower])).toEqual({
      attempt: "review-b",
      success: "review-b",
    });
  });
});

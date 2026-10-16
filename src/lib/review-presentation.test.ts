import { describe, expect, it } from "vitest";

import type { ReviewSnapshot, ReviewSummary } from "../shared/api";
import {
  describeAllowanceAvailability,
  isTerminalStatus,
  resolveReviewPresentation,
  reviewActionLabel,
  REVIEW_FAILURE_MESSAGES,
} from "./review-presentation";

const base = {
  id: "review-1",
  documentId: "doc-1",
  requestedByLawyerId: "lawyer-1",
  requestedAt: "2026-10-16T12:00:00.000Z",
  allowanceMonth: "2026-10",
};

function allowance(partial: {
  completed: number;
  reserved: number;
  available: number;
}) {
  return { month: "2026-10", limit: 10, ...partial };
}

describe("reviewActionLabel", () => {
  it("maps the latest attempt to the document action", () => {
    expect(reviewActionLabel(null)).toBe("Request review");
    expect(
      reviewActionLabel({
        ...base,
        status: "running",
        deadlineAt: "2026-10-16T12:01:00.000Z",
        emittedFindingCount: 0,
      }),
    ).toBe("Review in progress");
    expect(
      reviewActionLabel({
        ...base,
        status: "completed",
        completedAt: "2026-10-16T12:00:30.000Z",
        findingCount: 2,
      }),
    ).toBe("Review again");
    expect(
      reviewActionLabel({
        ...base,
        status: "failed",
        failedAt: "2026-10-16T12:00:30.000Z",
        failureReason: "ai_error",
      } satisfies ReviewSummary),
    ).toBe("Review again");
  });
});

describe("describeAllowanceAvailability", () => {
  it("allows requests when capacity remains", () => {
    expect(
      describeAllowanceAvailability(
        allowance({ completed: 3, reserved: 1, available: 6 }),
      ),
    ).toEqual({ canRequest: true, reason: null });
  });

  it("explains exhausted capacity distinctly from temporarily reserved", () => {
    expect(
      describeAllowanceAvailability(
        allowance({ completed: 10, reserved: 0, available: 0 }),
      ).reason,
    ).toBe("exhausted");
    expect(
      describeAllowanceAvailability(
        allowance({ completed: 4, reserved: 6, available: 0 }),
      ).reason,
    ).toBe("temporarily_reserved");
  });
});

describe("resolveReviewPresentation", () => {
  it("keeps running findings preliminary", () => {
    const snapshot: ReviewSnapshot = {
      ...base,
      status: "running",
      deadlineAt: "2026-10-16T12:01:00.000Z",
      partialFindings: [
        {
          position: 0,
          clause: null,
          title: "Finding",
          severity: "low",
          excerpt: null,
          explanation: "Detail",
          emittedAt: "2026-10-16T12:00:10.000Z",
        },
      ],
    };
    expect(resolveReviewPresentation(snapshot)).toEqual({
      kind: "running",
      findings: snapshot.partialFindings,
    });
  });

  it("presents a completed empty review as no issues flagged", () => {
    expect(
      resolveReviewPresentation({
        ...base,
        status: "completed",
        completedAt: "2026-10-16T12:00:30.000Z",
        findings: [],
      }),
    ).toEqual({ kind: "completed-empty" });
  });

  it("surfaces completed findings and failure messages", () => {
    const completed = resolveReviewPresentation({
      ...base,
      status: "completed",
      completedAt: "2026-10-16T12:00:30.000Z",
      findings: [
        {
          position: 0,
          clause: "1",
          title: "Finding",
          severity: "high",
          excerpt: null,
          explanation: "Detail",
          emittedAt: "2026-10-16T12:00:10.000Z",
        },
      ],
    });
    expect(completed.kind).toBe("completed");

    const failed = resolveReviewPresentation({
      ...base,
      status: "failed",
      failedAt: "2026-10-16T12:00:30.000Z",
      failureReason: "timed_out",
    });
    expect(failed).toEqual({
      kind: "failed",
      failureReason: "timed_out",
      message: REVIEW_FAILURE_MESSAGES.timed_out,
    });
  });
});

describe("isTerminalStatus", () => {
  it("treats completed and failed as terminal", () => {
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
  });
});

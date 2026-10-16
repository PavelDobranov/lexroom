import type Database from "better-sqlite3";

import { findingsForDocument } from "./document-findings";
import {
  type FindingInput,
  ReviewService,
} from "./review-service";

export type ReviewPlanEvent =
  | { atMs: number; type: "finding"; finding: FindingInput }
  | { atMs: number; type: "complete" };

export type ReviewPlan = {
  /** Strictly increasing event offsets in milliseconds from launch. */
  events: ReviewPlanEvent[];
};

export type Scheduler = {
  schedule(delayMs: number, callback: () => void): void;
};

export type ReviewRunnerDependencies = {
  openDatabase: () => Database.Database;
  now: () => Date;
  scheduler: Scheduler;
  /**
   * Chooses the immutable plan for a review from its source findings. This is
   * the outcome seam: production injects a randomized chooser, tests inject an
   * explicit plan. No public launch parameter may force an outcome.
   */
  createPlan: (findings: FindingInput[]) => ReviewPlan;
  lookupFindings?: (documentId: string) => FindingInput[] | undefined;
  logger?: Pick<Console, "error">;
};

export type ReviewRunner = {
  launch(input: { reviewId: string; documentId: string }): void;
};

/**
 * Builds a normal plan: every source finding emitted in source order, then
 * completion, over a 5–30 second window with strictly increasing offsets. A
 * document with no findings still completes successfully.
 */
export function createNormalPlan(
  findings: FindingInput[],
  randomMs: () => number = () =>
    5_000 + Math.floor(Math.random() * 25_001),
): ReviewPlan {
  const completionAt = randomMs();
  if (findings.length === 0) {
    return { events: [{ atMs: completionAt, type: "complete" }] };
  }

  const events: ReviewPlanEvent[] = [];
  let previous = 0;
  findings.forEach((finding, index) => {
    const target = Math.floor(
      (completionAt * (index + 1)) / (findings.length + 1),
    );
    const atMs = Math.max(target, previous + 1);
    previous = atMs;
    events.push({ atMs, type: "finding", finding });
  });
  const completeAt = Math.max(completionAt, previous + 1);
  events.push({ atMs: completeAt, type: "complete" });
  return { events };
}

export function createReviewRunner(
  dependencies: ReviewRunnerDependencies,
): ReviewRunner {
  const logger = dependencies.logger ?? console;
  const lookupFindings = dependencies.lookupFindings ?? findingsForDocument;

  const failToLaunch = (reviewId: string, reason: string, detail: unknown) => {
    logger.error(`Review ${reviewId} could not be launched: ${reason}`, detail);
    const sqlite = dependencies.openDatabase();
    try {
      new ReviewService(sqlite, dependencies.now).fail(reviewId, "ai_error");
    } catch (failureError) {
      logger.error(
        `Review ${reviewId} launch-failure transition failed`,
        failureError,
      );
    } finally {
      sqlite.close();
    }
  };

  const runEvent = (reviewId: string, event: ReviewPlanEvent) => {
    const sqlite = dependencies.openDatabase();
    try {
      const service = new ReviewService(sqlite, dependencies.now);
      if (event.type === "finding") {
        service.emitFinding(reviewId, event.finding);
      } else {
        service.complete(reviewId);
      }
    } catch (error) {
      // Late or racing callbacks are safe no-ops; log and move on.
      logger.error(`Review ${reviewId} callback failed`, error);
    } finally {
      sqlite.close();
    }
  };

  return {
    launch({ reviewId, documentId }) {
      const findings = lookupFindings(documentId);
      if (findings === undefined) {
        failToLaunch(reviewId, "no fixture for document", documentId);
        return;
      }

      let plan: ReviewPlan;
      try {
        plan = dependencies.createPlan(findings);
      } catch (error) {
        failToLaunch(reviewId, "plan construction failed", error);
        return;
      }

      for (const event of plan.events) {
        dependencies.scheduler.schedule(event.atMs, () =>
          runEvent(reviewId, event),
        );
      }
    },
  };
}

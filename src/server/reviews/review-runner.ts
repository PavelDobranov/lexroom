import type Database from "better-sqlite3";

import { findingsForDocument } from "./document-findings";
import {
  type FindingInput,
  ReviewService,
} from "./review-service";

export type ReviewPlanEvent =
  | { atMs: number; type: "finding"; finding: FindingInput }
  | { atMs: number; type: "complete" }
  | { atMs: number; type: "fail" };

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
  launch(input: {
    reviewId: string;
    documentId: string;
    deadlineAt: string;
  }): void;
};

function eventsEndingAt(
  findings: FindingInput[],
  terminalAt: number,
  terminalType: "complete" | "fail",
  firstAt = 1,
): ReviewPlan {
  const eventCount = findings.length + 1;
  const available = terminalAt - firstAt;
  const events: ReviewPlanEvent[] = findings.map((finding, index) => ({
    atMs: firstAt + (available * (index + 1)) / eventCount,
    type: "finding",
    finding,
  }));
  events.push({ atMs: terminalAt, type: terminalType });
  return { events };
}

function randomDuration(
  minimumMs: number,
  maximumMs: number,
  random: () => number,
): number {
  return minimumMs + Math.floor(random() * (maximumMs - minimumMs + 1));
}

/** Every source Finding followed by successful completion in 5–30 seconds. */
export function createNormalPlan(
  findings: FindingInput[],
  randomMs: () => number = () =>
    randomDuration(5_000, 30_000, Math.random),
): ReviewPlan {
  return eventsEndingAt(findings, randomMs(), "complete");
}

/** A source-ordered prefix followed by an AI failure in 5–30 seconds. */
export function createAiFailurePlan(
  findings: FindingInput[],
  options: { prefixLength?: number; terminalAtMs?: number } = {},
): ReviewPlan {
  const prefixLength =
    options.prefixLength ?? Math.floor(Math.random() * (findings.length + 1));
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > findings.length) {
    throw new Error("AI-failure prefix length is invalid");
  }
  const terminalAt =
    options.terminalAtMs ?? randomDuration(5_000, 30_000, Math.random);
  return eventsEndingAt(findings.slice(0, prefixLength), terminalAt, "fail");
}

/** All callbacks arrive after the strict 60-second deadline. */
export function createSlowPlan(
  findings: FindingInput[],
  terminalAtMs = randomDuration(60_001, 120_000, Math.random),
): ReviewPlan {
  return eventsEndingAt(findings, terminalAtMs, "complete", 60_000);
}

/** Production's agreed 70% normal, 20% AI-failure, and 10% slow mix. */
export function createProductionPlan(
  findings: FindingInput[],
  random: () => number = Math.random,
): ReviewPlan {
  const outcome = random();
  if (outcome < 0.7) {
    return createNormalPlan(findings, () => randomDuration(5_000, 30_000, random));
  }
  if (outcome < 0.9) {
    return createAiFailurePlan(findings, {
      prefixLength: Math.floor(random() * (findings.length + 1)),
      terminalAtMs: randomDuration(5_000, 30_000, random),
    });
  }
  return createSlowPlan(
    findings,
    randomDuration(60_001, 120_000, random),
  );
}

function validatePlan(plan: ReviewPlan): void {
  if (!plan || !Array.isArray(plan.events) || plan.events.length === 0) {
    throw new Error("Review plan must contain events");
  }
  let previous = -1;
  let terminalCount = 0;
  for (const [index, event] of plan.events.entries()) {
    if (!Number.isFinite(event.atMs) || event.atMs < 0 || event.atMs <= previous) {
      throw new Error("Review plan offsets must be finite and strictly increasing");
    }
    previous = event.atMs;
    if (event.type === "complete" || event.type === "fail") {
      terminalCount += 1;
      if (index !== plan.events.length - 1) {
        throw new Error("Review plan terminal event must be last");
      }
    }
  }
  if (terminalCount !== 1) {
    throw new Error("Review plan must have exactly one terminal event");
  }
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
      if (event.type === "finding") service.emitFinding(reviewId, event.finding);
      else if (event.type === "complete") service.complete(reviewId);
      else service.fail(reviewId, "ai_error");
    } catch (error) {
      logger.error(`Review ${reviewId} callback failed`, error);
    } finally {
      sqlite.close();
    }
  };

  const expire = (reviewId: string) => {
    const sqlite = dependencies.openDatabase();
    try {
      new ReviewService(sqlite, dependencies.now).expire(reviewId);
    } catch (error) {
      logger.error(`Review ${reviewId} timeout callback failed`, error);
    } finally {
      sqlite.close();
    }
  };

  return {
    launch({ reviewId, documentId, deadlineAt }) {
      const findings = lookupFindings(documentId);
      if (findings === undefined) {
        failToLaunch(reviewId, "no fixture for document", documentId);
        return;
      }

      let plan: ReviewPlan;
      try {
        plan = dependencies.createPlan(findings);
        validatePlan(plan);
        const deadlineDelay = Math.max(
          0,
          new Date(deadlineAt).getTime() - dependencies.now().getTime(),
        );
        dependencies.scheduler.schedule(deadlineDelay, () => expire(reviewId));
        for (const event of plan.events) {
          dependencies.scheduler.schedule(event.atMs, () =>
            runEvent(reviewId, event),
          );
        }
      } catch (error) {
        failToLaunch(reviewId, "plan construction or scheduling failed", error);
      }
    },
  };
}

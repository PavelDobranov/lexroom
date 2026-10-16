import { openDatabase, resolveDatabasePath } from "../db/database";
import {
  createAiFailurePlan,
  createNormalPlan,
  createProductionPlan,
  createReviewRunner,
  createSlowPlan,
  type ReviewRunner,
  type Scheduler,
} from "./review-runner";
import { ReviewService } from "./review-service";

// Best-effort, process-local timers for reviews this process accepted. Timer
// precision is not a correctness mechanism: late callbacks are rejected safely
// by ReviewService.
const realScheduler: Scheduler = {
  schedule(delayMs, callback) {
    const timer = setTimeout(callback, Math.max(0, delayMs));
    timer.unref?.();
  },
};

let runner: ReviewRunner | undefined;

/**
 * Creates a process-local, retryable initialization guard. Concurrent callers
 * share one reconciliation. Once it succeeds, later calls are harmless; a
 * failed attempt is cleared so temporary database unavailability can recover.
 */
export function createReviewRuntimeInitializer(
  reconcile: () => void | Promise<void>,
): () => Promise<void> {
  let initialization: Promise<void> | undefined;

  return () => {
    if (initialization) return initialization;

    const attempt = Promise.resolve().then(reconcile);
    const guardedAttempt = attempt.catch((error) => {
      if (initialization === guardedAttempt) initialization = undefined;
      throw error;
    });
    initialization = guardedAttempt;
    return guardedAttempt;
  };
}

export const initializeReviewRuntime = createReviewRuntimeInitializer(() => {
  const sqlite = openDatabase(resolveDatabasePath());
  try {
    new ReviewService(sqlite, () => new Date()).interruptRunningReviews();
  } finally {
    sqlite.close();
  }
});

function configuredPlan() {
  const forced = process.env.NODE_ENV === "production"
    ? undefined
    : process.env.LEXROOM_REVIEW_PLAN;
  if (forced === "normal") return createNormalPlan;
  if (forced === "ai_error") {
    return (findings: Parameters<typeof createAiFailurePlan>[0]) =>
      createAiFailurePlan(findings, { prefixLength: findings.length });
  }
  if (forced === "slow") return createSlowPlan;
  return createProductionPlan;
}

function defaultRunner(): ReviewRunner {
  if (!runner) {
    runner = createReviewRunner({
      openDatabase: () => openDatabase(resolveDatabasePath()),
      now: () => new Date(),
      scheduler: realScheduler,
      createPlan: configuredPlan(),
    });
  }
  return runner;
}

/** Launches the in-process fake runner for a newly admitted review. */
export function launchReview(input: {
  reviewId: string;
  documentId: string;
  deadlineAt: string;
}): void {
  defaultRunner().launch(input);
}

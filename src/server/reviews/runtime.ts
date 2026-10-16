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

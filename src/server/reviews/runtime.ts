import { openDatabase, resolveDatabasePath } from "../db/database";
import {
  createNormalPlan,
  createReviewRunner,
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

function defaultRunner(): ReviewRunner {
  if (!runner) {
    runner = createReviewRunner({
      openDatabase: () => openDatabase(resolveDatabasePath()),
      now: () => new Date(),
      scheduler: realScheduler,
      // M2.1 ships only the normal plan; later tickets add failure and slow
      // plans behind this same seam.
      createPlan: (findings) => createNormalPlan(findings),
    });
  }
  return runner;
}

/** Launches the in-process fake runner for a newly admitted review. */
export function launchReview(input: {
  reviewId: string;
  documentId: string;
}): void {
  defaultRunner().launch(input);
}

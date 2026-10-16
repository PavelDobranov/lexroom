import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect } from "react";

import type { ReviewSnapshot } from "../../../shared/api";
import { WORKSPACE_QUERY_KEY } from "../../_workspace/query";
import { isTerminalStatus, resolveReviewPresentation } from "../presentation";
import { reviewQueryOptions } from "../query";
import { FindingsList } from "./findings-list";
import { ModalShell } from "./modal-shell";

export function ReviewResultPanel({
  latestReviewId,
  latestSuccessfulReviewId,
  onClose,
  onRetry,
}: {
  latestReviewId: string;
  latestSuccessfulReviewId: string | null;
  onClose: () => void;
  onRetry: (documentId: string) => void;
}) {
  const queryClient = useQueryClient();
  const latestQuery = useQuery(
    reviewQueryOptions(latestReviewId, { enabled: true }),
  );
  const previousQuery = useQuery(
    reviewQueryOptions(latestSuccessfulReviewId ?? "", {
      enabled: latestSuccessfulReviewId !== null,
    }),
  );
  const latestStatus = latestQuery.data?.status;

  useEffect(() => {
    if (latestStatus && isTerminalStatus(latestStatus)) {
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });
    }
  }, [latestStatus, queryClient]);

  return (
    <ModalShell labelledBy="review-result-title" onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <h2 id="review-result-title" className="text-xl font-semibold text-slate-950">
          Review result
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      <div className="mt-5 max-h-[60vh] overflow-y-auto">
        <ReviewResultBody query={latestQuery} onRetry={onRetry} />

        {latestSuccessfulReviewId && (
          <section className="mt-6 border-t border-slate-200 pt-6" aria-labelledby="previous-review-title">
            <h3 id="previous-review-title" className="text-sm font-semibold text-slate-950">
              Previous completed review.
            </h3>
            <div className="mt-3">
              <PreviousCompletedReviewBody query={previousQuery} />
            </div>
          </section>
        )}
      </div>
      {latestQuery.isRefetchError && latestQuery.data && (
        <p className="mt-4 text-sm text-amber-800" role="status">
          The latest refresh failed. This result may be out of date.
        </p>
      )}
    </ModalShell>
  );
}

function PreviousCompletedReviewBody({
  query,
}: {
  query: UseQueryResult<ReviewSnapshot, Error>;
}) {
  if (query.data?.status === "completed") {
    return <ReviewResultBody query={query} />;
  }

  if (query.isError || (!query.isFetching && query.data)) {
    return (
      <div role="alert">
        <p className="text-sm text-rose-700">
          The previous completed review could not be loaded.
        </p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <p className="text-sm text-slate-600" aria-busy="true">
      Loading the completed review…
    </p>
  );
}

function ReviewResultBody({
  query,
  onRetry,
}: {
  query: UseQueryResult<ReviewSnapshot, Error>;
  onRetry?: (documentId: string) => void;
}) {
  if (query.isPending) {
    return (
      <p className="text-sm text-slate-600" aria-busy="true">
        Loading the review…
      </p>
    );
  }
  if (!query.data) {
    return (
      <div role="alert">
        <p className="text-sm text-rose-700">
          {query.error instanceof Error
            ? query.error.message
            : "The review could not be loaded."}
        </p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  const presentation = resolveReviewPresentation(query.data);

  if (presentation.kind === "running") {
    return (
      <div>
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold text-indigo-700">
            Review in progress — preliminary findings
          </p>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            Not final
          </span>
        </div>
        {presentation.findings.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No findings yet.</p>
        ) : (
          <FindingsList findings={presentation.findings} />
        )}
      </div>
    );
  }

  if (presentation.kind === "completed-empty") {
    return <p className="text-base font-medium text-emerald-700">No issues flagged.</p>;
  }

  if (presentation.kind === "completed") {
    return (
      <div>
        <p className="text-sm font-semibold text-emerald-700">Completed review</p>
        <FindingsList findings={presentation.findings} />
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium text-rose-700" role="alert">
        {presentation.message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={() => onRetry(query.data!.documentId)}
          className="mt-4 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Review again
        </button>
      )}
    </div>
  );
}

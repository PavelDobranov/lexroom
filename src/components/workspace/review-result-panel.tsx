import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { FindingSnapshot, ReviewSnapshot } from "../../shared/api";
import {
  isTerminalStatus,
  resolveReviewPresentation,
} from "../../lib/review-presentation";
import { reviewQueryOptions } from "../../lib/review-query";
import { WORKSPACE_QUERY_KEY } from "../../lib/workspace-query";
import { ModalShell } from "./modal-shell";

function SeverityTag({ severity }: { severity: "low" | "medium" | "high" }) {
  const styles = {
    high: "bg-rose-50 text-rose-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-slate-100 text-slate-700",
  } as const;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[severity]}`}>
      {severity}
    </span>
  );
}

function FindingsList({ findings }: { findings: FindingSnapshot[] }) {
  return (
    <ul className="mt-4 space-y-3">
      {findings.map((finding) => (
        <li key={finding.position} className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-950">
              {finding.clause ? `${finding.clause} — ` : ""}
              {finding.title}
            </h4>
            <SeverityTag severity={finding.severity} />
          </div>
          {finding.excerpt && (
            <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-sm italic text-slate-600">
              {finding.excerpt}
            </blockquote>
          )}
          <p className="mt-2 text-sm text-slate-700">{finding.explanation}</p>
        </li>
      ))}
    </ul>
  );
}

export function ReviewResultPanel({
  reviewId,
  onClose,
  onRetry,
}: {
  reviewId: string;
  onClose: () => void;
  onRetry: (documentId: string) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery(reviewQueryOptions(reviewId, { enabled: true }));
  const status = query.data?.status;

  useEffect(() => {
    if (status && isTerminalStatus(status)) {
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });
    }
  }, [status, queryClient]);

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
        <ReviewResultBody query={query} onRetry={onRetry} />
      </div>
      {query.isRefetchError && query.data && (
        <p className="mt-4 text-sm text-amber-800" role="status">
          The latest refresh failed. This result may be out of date.
        </p>
      )}
    </ModalShell>
  );
}

function ReviewResultBody({
  query,
  onRetry,
}: {
  query: ReturnType<typeof useQuery<ReviewSnapshot>>;
  onRetry: (documentId: string) => void;
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
    return <p className="text-base font-medium text-emerald-700">No issues flagged</p>;
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
      <button
        type="button"
        onClick={() => onRetry(query.data!.documentId)}
        className="mt-4 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
      >
        Retry review
      </button>
    </div>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { WorkspaceSnapshot } from "../../../shared/api";
import { WORKSPACE_QUERY_KEY } from "../../_workspace/query";
import { ReviewApiError } from "../api";
import { describeAllowanceAvailability } from "../presentation";
import { submitReviewRequest } from "../request-coordinator";
import { ModalShell } from "./modal-shell";

type Lawyer = WorkspaceSnapshot["lawyers"][number];
type Document = WorkspaceSnapshot["documents"][number];

export type ReviewConfirmationDialogProps = {
  document: Document;
  lawyer: Lawyer;
  allowance: WorkspaceSnapshot["monthlyAllowance"];
  onClose: () => void;
  onCreated: (reviewId: string) => void;
};

export function ReviewConfirmationDialog({
  document,
  lawyer,
  allowance,
  onClose,
  onCreated,
}: ReviewConfirmationDialogProps) {
  const queryClient = useQueryClient();
  const availability = describeAllowanceAvailability(allowance);

  const mutation = useMutation({
    mutationFn: () =>
      submitReviewRequest({
        documentId: document.id,
        requestedByLawyerId: lawyer.id,
        baselineLatestReviewId: document.latestReviewAttempt?.id ?? null,
      }),
    onSuccess: (review) => {
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });
      onCreated(review.id);
    },
    onError: () => {
      // Keep the dialog open and refresh potentially stale workspace data;
      // the server remains authoritative after any rejected request.
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });
    },
  });

  const requestErrorMessage =
    mutation.error instanceof ReviewApiError
      ? mutation.error.message
      : mutation.isError
        ? "The review could not be requested."
        : null;

  return (
    <ModalShell labelledBy="review-dialog-title" onClose={onClose}>
      <h2 id="review-dialog-title" className="text-xl font-semibold text-slate-950">
        Request a review
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        <span className="font-medium text-slate-900">{document.title}</span>, as{" "}
        <span className="font-medium text-slate-900">
          {lawyer.name} — {lawyer.title}
        </span>
        .
      </p>

      <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
        {[
          { label: "Completed", value: allowance.completed },
          { label: "Reserved", value: allowance.reserved },
          { label: "Available", value: allowance.available },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {item.label}
            </dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-950">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-slate-600">
        A successful review consumes one reserved slot; a failed review releases it.
      </p>

      {!availability.canRequest && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          {availability.message}
        </p>
      )}
      {requestErrorMessage && (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert">
          {requestErrorMessage}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!availability.canRequest || mutation.isPending}
          className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? "Requesting…" : "Request review"}
        </button>
      </div>
    </ModalShell>
  );
}

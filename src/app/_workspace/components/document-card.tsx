import type { ReviewSummary, WorkspaceSnapshot } from "../../../shared/api";
import { reviewActionLabel } from "../../_review/presentation";
import { formatDocumentType, formatUploadDate } from "../presentation";

type Lawyer = WorkspaceSnapshot["lawyers"][number];
type Document = WorkspaceSnapshot["documents"][number];

function ReviewStatusBadge({ attempt }: { attempt: ReviewSummary | null }) {
  if (!attempt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
        <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
        Not reviewed
      </span>
    );
  }

  if (attempt.status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700">
        <span className="size-2 animate-pulse rounded-full bg-indigo-500" aria-hidden="true" />
        Review in progress
      </span>
    );
  }

  if (attempt.status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
        Reviewed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700">
      <span className="size-2 rounded-full bg-rose-500" aria-hidden="true" />
      Review failed
    </span>
  );
}

export function DocumentCard({
  document,
  uploader,
  onRequest,
  onView,
}: {
  document: Document;
  uploader: Lawyer | undefined;
  onRequest: () => void;
  onView: () => void;
}) {
  const attempt = document.latestReviewAttempt;
  const label = reviewActionLabel(attempt);
  const running = attempt?.status === "running";

  return (
    <li className="flex min-h-60 flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-4">
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
          {formatDocumentType(document.type)}
        </span>
        <ReviewStatusBadge attempt={attempt} />
      </div>
      <h3 className="mt-5 text-lg font-semibold leading-7 text-slate-950">{document.title}</h3>
      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-slate-500">Pages</dt>
          <dd className="mt-0.5 font-medium text-slate-800">{document.pages}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Uploaded by</dt>
          <dd className="mt-0.5 font-medium text-slate-800">{uploader?.name ?? "Unknown lawyer"}</dd>
        </div>
        <div className="col-span-2 border-t border-slate-100 pt-3">
          <dt className="text-slate-500">Uploaded</dt>
          <dd className="mt-0.5 font-medium text-slate-800">
            <time dateTime={document.uploadedAt}>{formatUploadDate(document.uploadedAt)}</time>
          </dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-wrap gap-2 pt-6">
        {running ? (
          <button
            type="button"
            onClick={onView}
            className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
          >
            Review in progress
          </button>
        ) : (
          <button
            type="button"
            onClick={onRequest}
            className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
          >
            {label}
          </button>
        )}
        {attempt && !running && (
          <button
            type="button"
            onClick={onView}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
          >
            View result
          </button>
        )}
      </div>
    </li>
  );
}

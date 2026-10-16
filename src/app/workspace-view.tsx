"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type {
  FindingSnapshot,
  ReviewSnapshot,
  ReviewSummary,
  WorkspaceSnapshot,
} from "../shared/api";
import {
  describeAllowanceAvailability,
  isTerminalStatus,
  resolveReviewPresentation,
  reviewActionLabel,
} from "./review-presentation";
import {
  requestReview,
  ReviewRequestError,
  reviewQueryOptions,
} from "./review-query";
import {
  WORKSPACE_QUERY_KEY,
  WORKSPACE_QUERY_OPTIONS,
} from "./workspace-query";

export const SELECTED_LAWYER_STORAGE_KEY = "lexroom.selected-lawyer-id";

const selectionListeners = new Set<() => void>();
let inMemorySelection: string | null = null;

function readSelectedLawyerId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_LAWYER_STORAGE_KEY);
  } catch {
    return inMemorySelection;
  }
}

function writeSelectedLawyerId(lawyerId: string): void {
  inMemorySelection = lawyerId;
  try {
    window.localStorage.setItem(SELECTED_LAWYER_STORAGE_KEY, lawyerId);
  } catch {
    // The in-memory selection remains usable when persistence is blocked.
  }
  selectionListeners.forEach((listener) => listener());
}

function subscribeToSelectedLawyer(listener: () => void): () => void {
  selectionListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SELECTED_LAWYER_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    selectionListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

type Lawyer = WorkspaceSnapshot["lawyers"][number];

type Document = WorkspaceSnapshot["documents"][number];

export function resolveSelectedLawyerId(
  lawyers: Lawyer[],
  candidateId: string | null,
): string | null {
  if (candidateId && lawyers.some(({ id }) => id === candidateId)) {
    return candidateId;
  }
  return lawyers[0]?.id ?? null;
}

export function formatDocumentType(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (normalized === "nda") return "NDA";
  if (normalized === "saas") return "SaaS";
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function formatUploadDate(uploadedAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(uploadedAt));
}

function WorkspaceLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 lg:py-16" aria-busy="true">
      <span className="sr-only">Loading workspace</span>
      <div className="h-4 w-28 animate-pulse rounded-full bg-slate-200" />
      <div className="mt-5 h-12 w-80 max-w-full animate-pulse rounded-xl bg-slate-200" />
      <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="h-52 animate-pulse rounded-2xl bg-white shadow-sm ring-1 ring-slate-200" />
        ))}
      </div>
    </main>
  );
}

function InitialError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-5 py-12 sm:px-8">
      <section className="w-full rounded-2xl bg-white p-7 shadow-sm ring-1 ring-rose-200" role="alert">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-700">Workspace unavailable</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">We couldn&apos;t load Lexroom.</h1>
        <p className="mt-3 text-slate-600">{message}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-6 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
        >
          Try again
        </button>
      </section>
    </main>
  );
}

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

function DocumentCard({
  document,
  uploader,
  onRequest,
  onView,
}: {
  document: Document;
  uploader: Lawyer | undefined;
  onRequest: () => void;
  onView: (reviewId: string) => void;
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
            onClick={() => onView(attempt!.id)}
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
            onClick={() => onView(attempt.id)}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
          >
            View result
          </button>
        )}
      </div>
    </li>
  );
}

function ModalShell({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-950/40"
        aria-hidden="true"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200"
      >
        {children}
      </section>
    </div>
  );
}

function ReviewConfirmationDialog({
  document,
  lawyer,
  allowance,
  onClose,
  onCreated,
}: {
  document: Document;
  lawyer: Lawyer;
  allowance: WorkspaceSnapshot["monthlyAllowance"];
  onClose: () => void;
  onCreated: (reviewId: string) => void;
}) {
  const queryClient = useQueryClient();
  // One request ID per intentional confirmation.
  const [requestId] = useState(() => crypto.randomUUID());
  const availability = describeAllowanceAvailability(allowance);

  const mutation = useMutation({
    mutationFn: () =>
      requestReview({
        documentId: document.id,
        requestedByLawyerId: lawyer.id,
        requestId,
      }),
    onSuccess: (review) => {
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });
      onCreated(review.id);
    },
    onError: () => {
      // Admission conflicts leave the dialog open and refresh the workspace;
      // the server stays authoritative when the visible snapshot is stale.
      void queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });
    },
  });

  const conflictMessage =
    mutation.error instanceof ReviewRequestError
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
      {conflictMessage && (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert">
          {conflictMessage}
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

function FindingsList({
  findings,
}: {
  findings: FindingSnapshot[];
}) {
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

function ReviewResultPanel({
  reviewId,
  onClose,
}: {
  reviewId: string;
  onClose: () => void;
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
        <ReviewResultBody query={query} />
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
}: {
  query: ReturnType<typeof useQuery<ReviewSnapshot>>;
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
    <p className="text-sm font-medium text-rose-700" role="alert">
      {presentation.message}
    </p>
  );
}

function NoLawyers() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-5 py-12 sm:px-8">
      <section className="w-full rounded-2xl bg-white p-7 shadow-sm ring-1 ring-amber-200" role="alert">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">Setup needed</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">No lawyers are available.</h1>
        <p className="mt-3 text-slate-600">Initialize the workspace data, then reload this page.</p>
      </section>
    </main>
  );
}

function WorkspaceContent() {
  const query = useQuery(WORKSPACE_QUERY_OPTIONS);
  const queryClient = useQueryClient();

  useEffect(() => {
    const refetchOnFocus = () => {
      void queryClient.refetchQueries({
        queryKey: WORKSPACE_QUERY_KEY,
        type: "active",
      });
    };
    window.addEventListener("focus", refetchOnFocus);
    return () => window.removeEventListener("focus", refetchOnFocus);
  }, [queryClient]);

  if (query.isPending) return <WorkspaceLoading />;
  if (!query.data && query.isError) {
    return <InitialError message={query.error.message} retry={() => void query.refetch()} />;
  }
  if (!query.data) return null;
  if (query.data.lawyers.length === 0) return <NoLawyers />;

  return (
    <WorkspaceReady
      snapshot={query.data}
      refreshFailed={query.isRefetchError}
      refetch={() => void query.refetch()}
    />
  );
}

function WorkspaceReady({
  snapshot,
  refreshFailed,
  refetch,
}: {
  snapshot: WorkspaceSnapshot;
  refreshFailed: boolean;
  refetch: () => void;
}) {
  const lawyers = snapshot.lawyers;
  const selectedLawyerId = useSyncExternalStore(
    subscribeToSelectedLawyer,
    readSelectedLawyerId,
    () => null,
  );
  const activeLawyerId = resolveSelectedLawyerId(lawyers, selectedLawyerId)!;
  const lawyersById = useMemo(
    () => new Map(lawyers.map((lawyer) => [lawyer.id, lawyer])),
    [lawyers],
  );

  useEffect(() => {
    if (selectedLawyerId !== activeLawyerId) {
      writeSelectedLawyerId(activeLawyerId);
    }
  }, [activeLawyerId, selectedLawyerId]);

  const [dialogDocumentId, setDialogDocumentId] = useState<string | null>(null);
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);

  const activeLawyer = lawyersById.get(activeLawyerId);
  const dialogDocument = dialogDocumentId
    ? snapshot.documents.find((document) => document.id === dialogDocumentId) ??
      null
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 lg:py-16">
      <header className="flex flex-col gap-8 border-b border-slate-200 pb-10 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-indigo-700">Lexroom workspace</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-5xl">
            Contracts, ready when you are.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
            Browse the firm&apos;s shared documents and review availability.
          </p>
        </div>
        <div className="w-full max-w-sm">
          <label htmlFor="lawyer-selector" className="mb-2 block text-sm font-semibold text-slate-800">
            Working as
          </label>
          <select
            id="lawyer-selector"
            value={activeLawyerId}
            onChange={(event) => writeSelectedLawyerId(event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-indigo-600 focus:ring-3 focus:ring-indigo-100"
          >
            {lawyers.map((lawyer) => (
              <option key={lawyer.id} value={lawyer.id}>
                {lawyer.name} — {lawyer.title}
              </option>
            ))}
          </select>
        </div>
      </header>

      {refreshFailed && (
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="status">
          <span>The latest refresh failed. This workspace may be out of date.</span>
          <button
            type="button"
            onClick={refetch}
            className="self-start font-semibold underline decoration-amber-400 underline-offset-4 hover:text-amber-700 sm:self-auto"
          >
            Refresh now
          </button>
        </div>
      )}

      <section className="mt-8 rounded-2xl bg-slate-950 px-6 py-6 text-white shadow-lg shadow-slate-200 sm:flex sm:items-center sm:justify-between sm:px-8">
        <div>
          <p className="text-sm font-medium text-slate-400">Monthly allowance</p>
          <p className="mt-1 text-xl font-semibold">
            {snapshot.monthlyAllowance.available} of {snapshot.monthlyAllowance.limit} reviews available this month.
          </p>
        </div>
        <p className="mt-4 text-sm font-medium text-slate-400 sm:mt-0">{snapshot.monthlyAllowance.month}</p>
      </section>

      <section className="mt-12" aria-labelledby="documents-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-700">Shared library</p>
            <h2 id="documents-heading" className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              Documents
            </h2>
          </div>
          <p className="text-sm text-slate-500">{snapshot.documents.length} total</p>
        </div>

        {snapshot.documents.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-slate-600">
            No documents available
          </p>
        ) : (
          <ul className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {snapshot.documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                uploader={lawyersById.get(document.uploadedByLawyerId)}
                onRequest={() => setDialogDocumentId(document.id)}
                onView={(reviewId) => setOpenReviewId(reviewId)}
              />
            ))}
          </ul>
        )}
      </section>

      {dialogDocument && activeLawyer && (
        <ReviewConfirmationDialog
          document={dialogDocument}
          lawyer={activeLawyer}
          allowance={snapshot.monthlyAllowance}
          onClose={() => setDialogDocumentId(null)}
          onCreated={(reviewId) => {
            setDialogDocumentId(null);
            setOpenReviewId(reviewId);
          }}
        />
      )}
      {openReviewId && (
        <ReviewResultPanel
          reviewId={openReviewId}
          onClose={() => setOpenReviewId(null)}
        />
      )}
    </main>
  );
}

export default function WorkspaceView() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceContent />
    </QueryClientProvider>
  );
}

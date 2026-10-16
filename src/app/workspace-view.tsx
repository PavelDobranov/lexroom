"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { WorkspaceSnapshot } from "../shared/api";
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

function DocumentCard({
  document,
  uploader,
}: {
  document: Document;
  uploader: Lawyer | undefined;
}) {
  return (
    <li className="flex min-h-60 flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-4">
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
          {formatDocumentType(document.type)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
          Not reviewed
        </span>
      </div>
      <h3 className="mt-5 text-lg font-semibold leading-7 text-slate-950">{document.title}</h3>
      <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-3 pt-7 text-sm">
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
    </li>
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
              />
            ))}
          </ul>
        )}
      </section>
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

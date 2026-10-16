"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
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
  }).format(new Date(uploadedAt));
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      {children}
    </svg>
  );
}

function FileIcon() {
  return (
    <Icon>
      <path d="M6.75 3.75h6.5l4 4v12.5H6.75z" />
      <path d="M13.25 3.75v4h4" />
      <path d="M9.5 13h5M9.5 16h5" />
    </Icon>
  );
}

function CheckIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.25" />
      <path d="m8.5 12 2.25 2.25 4.75-5" />
    </Icon>
  );
}

function ClockIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

function SparkIcon() {
  return (
    <Icon>
      <path d="M12 3.5 13.7 8l4.8 1.8-4.8 1.8L12 16l-1.7-4.4-4.8-1.8L10.3 8z" />
      <path d="m18.5 15 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </Icon>
  );
}

function WorkspaceLoading() {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8" aria-busy="true">
      <span className="sr-only">Loading workspace</span>
      <div className="h-9 w-56 animate-pulse rounded-lg bg-slate-200" />
      <div className="mt-3 h-5 w-80 max-w-full animate-pulse rounded bg-slate-200" />
      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" />
        ))}
      </div>
      <div className="mt-5 h-96 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" />
    </main>
  );
}

function InitialError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-5 py-12 sm:px-8">
      <section className="w-full rounded-xl bg-white p-7 shadow-sm ring-1 ring-rose-200" role="alert">
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

function NoLawyers() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-5 py-12 sm:px-8">
      <section className="w-full rounded-xl bg-white p-7 shadow-sm ring-1 ring-amber-200" role="alert">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">Setup needed</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">No lawyers are available.</h1>
        <p className="mt-3 text-slate-600">Initialize the workspace data, then reload this page.</p>
      </section>
    </main>
  );
}

function AppHeader({ lawyer }: { lawyer: Lawyer }) {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1536px] items-center px-5 sm:px-8">
        <div className="text-xl font-bold tracking-[-0.03em] text-slate-950">Lexroom</div>
        <nav aria-label="Primary" className="ml-10 hidden h-full items-center gap-2 md:flex">
          <span aria-current="page" className="rounded-lg bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">Workspace</span>
          <span className="px-4 py-2 text-sm font-medium text-slate-600">Documents</span>
          <span className="px-4 py-2 text-sm font-medium text-slate-600">Reviews</span>
          <span className="px-4 py-2 text-sm font-medium text-slate-600">Lawyers</span>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-800">
            {initials(lawyer.name)}
          </span>
          <span className="hidden text-sm font-medium text-slate-800 sm:inline">{lawyer.name}</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" className="size-4 text-slate-500">
            <path d="m6 8 4 4 4-4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </header>
  );
}

function StatCard({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "slate" | "blue" | "green" | "amber";
  icon: ReactNode;
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
  };

  return (
    <article className="flex min-h-28 items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/90">
      <span className={`flex size-12 shrink-0 items-center justify-center rounded-full ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{detail}</p>
      </div>
    </article>
  );
}

function typeBadgeClass(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (["nda", "license"].includes(normalized)) return "bg-blue-50 text-blue-700";
  if (["lease", "loan"].includes(normalized)) return "bg-violet-50 text-violet-700";
  if (["employment", "services"].includes(normalized)) return "bg-emerald-50 text-emerald-700";
  if (["saas", "supply"].includes(normalized)) return "bg-amber-50 text-amber-700";
  if (["shareholders", "settlement"].includes(normalized)) return "bg-rose-50 text-rose-700";
  return "bg-cyan-50 text-cyan-700";
}

function DocumentsTable({
  documents,
  lawyersById,
}: {
  documents: Document[];
  lawyersById: Map<string, Lawyer>;
}) {
  if (documents.length === 0) {
    return (
      <p className="m-5 rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center text-slate-600">
        No documents available
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-y border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
            <th className="px-5 py-3">Title</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3 text-center">Pages</th>
            <th className="px-4 py-3">Uploaded</th>
            <th className="px-4 py-3">Uploaded by</th>
            <th className="px-4 py-3">Review status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {documents.map((document) => (
            <tr key={document.id} className="text-slate-700 transition hover:bg-slate-50/70">
              <td className="max-w-md px-5 py-3 font-medium text-slate-900">{document.title}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${typeBadgeClass(document.type)}`}>
                  {formatDocumentType(document.type)}
                </span>
              </td>
              <td className="px-4 py-3 text-center">{document.pages}</td>
              <td className="whitespace-nowrap px-4 py-3">
                <time dateTime={document.uploadedAt}>{formatUploadDate(document.uploadedAt)}</time>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {lawyersById.get(document.uploadedByLawyerId)?.name ?? "Unknown lawyer"}
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  Not reviewed
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LawyerCard({
  lawyers,
  activeLawyerId,
}: {
  lawyers: Lawyer[];
  activeLawyerId: string;
}) {
  const activeLawyer = lawyers.find(({ id }) => id === activeLawyerId)!;

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/90" aria-labelledby="lawyer-heading">
      <h2 id="lawyer-heading" className="text-lg font-semibold tracking-tight text-slate-950">Current lawyer</h2>
      <p className="mt-1 text-sm text-slate-500">Select the lawyer you&apos;re working as</p>
      <label htmlFor="lawyer-selector" className="sr-only">Current lawyer</label>
      <div className="relative mt-4">
        <span className="pointer-events-none absolute left-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-800">
          {initials(activeLawyer.name)}
        </span>
        <select
          id="lawyer-selector"
          value={activeLawyerId}
          onChange={(event) => writeSelectedLawyerId(event.target.value)}
          className="h-16 w-full appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-16 pr-10 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-600 focus:ring-3 focus:ring-blue-100"
        >
          {lawyers.map((lawyer) => (
            <option key={lawyer.id} value={lawyer.id}>
              {lawyer.name}
            </option>
          ))}
        </select>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-600">
          <path d="m6 8 4 4 4-4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="mt-2 pl-16 text-xs text-slate-500">{activeLawyer.title}</p>
    </section>
  );
}

function AllowanceCard({ allowance }: { allowance: WorkspaceSnapshot["monthlyAllowance"] }) {
  const used = allowance.completed + allowance.reserved;

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/90" aria-labelledby="quota-heading">
      <h2 id="quota-heading" className="text-lg font-semibold tracking-tight text-slate-950">Monthly review quota</h2>
      <p className="mt-1 text-sm text-slate-500">{formatMonth(allowance.month)}</p>
      <p className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">
        {used} <span className="text-slate-400">/</span> {allowance.limit}
      </p>
      <p className="text-sm text-slate-500">reviews used</p>
      <dl className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-sm">
        <div className="flex items-center gap-3">
          <span className="size-2.5 rounded-full bg-blue-600" aria-hidden="true" />
          <dt className="text-slate-600">Completed reviews</dt>
          <dd className="ml-auto font-medium text-slate-900">{allowance.completed}</dd>
        </div>
        <div className="flex items-center gap-3">
          <span className="size-2.5 rounded-full bg-sky-300" aria-hidden="true" />
          <dt className="text-slate-600">Reserved</dt>
          <dd className="ml-auto font-medium text-slate-900">{allowance.reserved}</dd>
        </div>
        <div className="flex items-center gap-3">
          <span className="size-2.5 rounded-full bg-slate-300" aria-hidden="true" />
          <dt className="text-slate-600">Available</dt>
          <dd className="ml-auto font-medium text-slate-900">{allowance.available}</dd>
        </div>
      </dl>
      <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
        {allowance.available} of {allowance.limit} reviews available this month.
      </p>
    </section>
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
  const activeLawyer = lawyers.find(({ id }) => id === activeLawyerId)!;
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
    <>
      <AppHeader lawyer={activeLawyer} />
      <main className="mx-auto w-full max-w-[1536px] flex-1 px-5 py-7 sm:px-8">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
          <div className="min-w-0">
            <header>
              <h1 className="text-3xl font-semibold tracking-[-0.035em] text-slate-950">Workspace</h1>
              <p className="mt-1 text-base text-slate-500">Overview of your documents, reviews and usage.</p>
            </header>

            {refreshFailed && (
              <div className="mt-5 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="status">
                <span>The latest refresh failed. This workspace may be out of date.</span>
                <button type="button" onClick={refetch} className="self-start font-semibold underline decoration-amber-400 underline-offset-4 hover:text-amber-700 sm:self-auto">
                  Refresh now
                </button>
              </div>
            )}

            <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workspace summary">
              <StatCard label="Documents" value={snapshot.documents.length} detail="All uploaded documents" tone="slate" icon={<FileIcon />} />
              <StatCard label="Completed reviews" value={snapshot.monthlyAllowance.completed} detail="This month" tone="green" icon={<CheckIcon />} />
              <StatCard label="Reserved reviews" value={snapshot.monthlyAllowance.reserved} detail="In progress" tone="blue" icon={<ClockIcon />} />
              <StatCard label="Reviews available" value={snapshot.monthlyAllowance.available} detail="This month" tone="amber" icon={<SparkIcon />} />
            </section>

            <section className="mt-5 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/90" aria-labelledby="documents-heading">
              <div className="flex items-end justify-between gap-4 px-5 py-5">
                <div>
                  <h2 id="documents-heading" className="text-xl font-semibold tracking-tight text-slate-950">Documents</h2>
                  <p className="mt-1 text-sm text-slate-500">All documents in your workspace with their latest review status.</p>
                </div>
                <p className="whitespace-nowrap text-sm text-slate-500">{snapshot.documents.length} total</p>
              </div>
              <DocumentsTable documents={snapshot.documents} lawyersById={lawyersById} />
            </section>
          </div>

          <aside className="space-y-5 xl:pt-0">
            <LawyerCard lawyers={lawyers} activeLawyerId={activeLawyerId} />
            <AllowanceCard allowance={snapshot.monthlyAllowance} />
            <section className="rounded-xl border border-dashed border-slate-300 bg-white/50 px-5 py-8 text-center" aria-label="Recent activity placeholder">
              <p className="text-sm font-medium text-slate-600">Recent activity</p>
              <p className="mt-1 text-xs text-slate-400">Activity will appear here when reviews are available.</p>
            </section>
          </aside>
        </div>
      </main>
    </>
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

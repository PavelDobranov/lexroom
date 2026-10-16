"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { WorkspaceSnapshot } from "../../../shared/api";
import { ReviewConfirmationDialog } from "../../_review/components/review-confirmation-dialog";
import { ReviewResultPanel } from "../../_review/components/review-result-panel";
import { reviewIdsToOpen } from "../../_review/presentation";
import {
  readSelectedLawyerId,
  resolveSelectedLawyerId,
  subscribeToSelectedLawyer,
  writeSelectedLawyerId,
} from "../selection";
import { WORKSPACE_QUERY_KEY, WORKSPACE_QUERY_OPTIONS } from "../query";
import { DocumentCard } from "./document-card";
import { LawyerPicker } from "./lawyer-picker";
import { InitialError, NoLawyers, WorkspaceLoading } from "./status-screens";

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
  const [openReview, setOpenReview] = useState<{
    documentId: string;
    latestReviewId?: string;
  } | null>(null);

  const activeLawyer = lawyersById.get(activeLawyerId);
  const dialogDocument = dialogDocumentId
    ? snapshot.documents.find((document) => document.id === dialogDocumentId) ??
      null
    : null;
  const openDocument = openReview
    ? snapshot.documents.find((document) => document.id === openReview.documentId) ??
      null
    : null;
  const reviewIds = openDocument
    ? reviewIdsToOpen(openDocument, openReview?.latestReviewId)
    : { latestReviewId: null, previousSuccessfulReviewId: null };

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
        <LawyerPicker
          lawyers={lawyers}
          selectedLawyerId={activeLawyerId}
          onChange={writeSelectedLawyerId}
        />
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
                onView={() => setOpenReview({ documentId: document.id })}
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
            setOpenReview({
              documentId: dialogDocument.id,
              latestReviewId: reviewId,
            });
          }}
        />
      )}
      {openReview && reviewIds.latestReviewId && (
        <ReviewResultPanel
          latestReviewId={reviewIds.latestReviewId}
          latestSuccessfulReviewId={reviewIds.previousSuccessfulReviewId}
          onClose={() => setOpenReview(null)}
          onRetry={(documentId) => {
            setOpenReview(null);
            setDialogDocumentId(documentId);
          }}
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

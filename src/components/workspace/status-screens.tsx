export function WorkspaceLoading() {
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

export function InitialError({ message, retry }: { message: string; retry: () => void }) {
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

export function NoLawyers() {
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

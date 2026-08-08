export default function PausedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <section className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl sm:p-12">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-teal-300">Sulcai</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">The beta is paused.</h1>
        <p className="mt-6 text-lg leading-8 text-slate-300">
          We have temporarily paused Grounded Study while we review the beta and plan what comes next.
          New uploads and question generation are unavailable during this period.
        </p>
        <p className="mt-6 text-sm leading-6 text-slate-400">
          Existing project data has been preserved for a possible future restart. Thank you for helping us
          test Sulcai.
        </p>
      </section>
    </main>
  );
}

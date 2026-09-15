// Streaming placeholder shown by each route's loading.tsx while its
// server component awaits its data fetch, so navigation feels instant
// instead of a blank/frozen page until the DB round-trip resolves.
export default function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="h-7 w-48 rounded bg-slate-200" />
      <div className="card">
        <div className="h-5 w-32 rounded bg-slate-200 mb-4" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="h-8 w-full rounded bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}

// Plain-link pagination (works with JS disabled, no client component
// needed) — preserves every existing query param except `page`.
export default function Pager({
  page,
  pageSize,
  total,
  searchParams,
}: {
  page: number;
  pageSize: number;
  total: number;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  function hrefFor(p: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "page") continue;
      if (typeof value === "string" && value) params.set(key, value);
    }
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }

  return (
    <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
      <span>
        صفحة {page} من {totalPages} — {total} سجل
      </span>
      <div className="flex gap-2">
        <a
          href={hrefFor(Math.max(1, page - 1))}
          aria-disabled={page <= 1}
          className={`btn btn-secondary text-xs px-2 py-1 ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}
        >
          السابق
        </a>
        <a
          href={hrefFor(Math.min(totalPages, page + 1))}
          aria-disabled={page >= totalPages}
          className={`btn btn-secondary text-xs px-2 py-1 ${page >= totalPages ? "pointer-events-none opacity-40" : ""}`}
        >
          التالي
        </a>
      </div>
    </div>
  );
}

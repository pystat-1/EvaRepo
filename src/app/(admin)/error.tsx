"use client";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card border-red-200 bg-red-50">
      <h2 className="font-bold text-red-700 mb-2">حدث خطأ</h2>
      <p className="text-sm text-red-700 mb-4">{error.message}</p>
      <button onClick={() => reset()} className="btn btn-secondary">
        إعادة المحاولة
      </button>
    </div>
  );
}

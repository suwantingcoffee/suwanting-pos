type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton-shimmer rounded-xl ${className}`}
    />
  );
}

export function DashboardSkeleton() {
  return (
    <div
      aria-label="Memuat ringkasan dashboard"
      className="space-y-5"
      role="status"
    >
      <span className="sr-only">Memuat dashboard...</span>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="rounded-2xl border bg-surface p-5" key={index}>
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-5 h-8 w-36" />
            <Skeleton className="mt-4 h-3 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-52 w-full" />
    </div>
  );
}

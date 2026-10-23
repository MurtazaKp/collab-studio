import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-6 pt-8 lg:px-10" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-8 w-72" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

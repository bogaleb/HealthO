import { Skeleton } from "@projectos/ui";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading provider">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-7 w-96" />
      <Skeleton className="h-40" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}

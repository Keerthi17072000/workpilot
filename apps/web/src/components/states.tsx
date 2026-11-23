import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export function EmptyState({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <div className="rounded-full bg-muted p-2.5"><Icon className="h-5 w-5 text-muted-foreground" aria-hidden /></div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-6 text-center">
      <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
      <p className="text-sm font-medium">Couldn't load this</p>
      <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export const ListSkeleton = ({ rows = 3 }: { rows?: number }) => (
  <div className="space-y-3" aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="space-y-1.5"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
    ))}
  </div>
);

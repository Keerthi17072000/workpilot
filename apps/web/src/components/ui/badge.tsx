import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const v = cva("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground",
      urgent: "bg-destructive/15 text-destructive",
      important: "bg-warning/20 text-[color-mix(in_oklch,var(--warning)_55%,var(--foreground))]",
      success: "bg-success/15 text-success",
      info: "bg-primary/15 text-primary",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export const Badge = ({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof v>) =>
  <span className={cn(v({ tone }), className)} {...p} />;

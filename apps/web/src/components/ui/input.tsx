import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const field = "h-9 w-full rounded-lg border bg-card px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50";
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, className)} {...p} />;
export const NativeSelect = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, "cursor-pointer", className)} {...p} />;
export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label className={cn("text-sm font-medium", className)} {...p} />;

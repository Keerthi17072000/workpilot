import * as S from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export const Switch = ({ className, ...p }: S.SwitchProps) => (
  <S.Root className={cn("h-5 w-9 shrink-0 cursor-pointer rounded-full bg-muted-foreground/40 transition-colors data-[state=checked]:bg-primary disabled:opacity-50", className)} {...p}>
    <S.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
  </S.Root>
);

import { Hammer } from "lucide-react";
import { EmptyState } from "@/components/states";
import { Card } from "@/components/ui/card";

export function ComingSoon({ title, phase, blurb }: { title: string; phase: number; blurb: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card><EmptyState icon={Hammer} title={`Arrives in Phase ${phase}`} hint={blurb} /></Card>
    </div>
  );
}

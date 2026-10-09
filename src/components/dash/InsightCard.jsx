import { Check } from "lucide-react";
import { insight } from "@/lib/metrics";

export default function InsightCard({ day }) {
  const { title, body } = insight(day);
  return (
    <div className="flex gap-4 rounded-2xl border border-hairline bg-surface p-5">
      <div className="flex-1">
        <p className="font-heading text-lg font-semibold">{title}</p>
        <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div className="flex h-12 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-card">
        <Check className="h-4 w-4" />
      </div>
    </div>
  );
}
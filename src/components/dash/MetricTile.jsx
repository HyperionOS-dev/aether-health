import { ArrowUp, ArrowDown } from "lucide-react";
import Label from "./Label";

export default function MetricTile({ label, value, unit, average, lowerIsBetter }) {
  const diff = value != null && average != null ? value - average : null;
  const good = diff != null && (lowerIsBetter ? diff <= 0 : diff >= 0);
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4">
      <Label>{label}</Label>
      <p className="mt-1 font-display text-[32px] font-bold leading-tight">
        {value ?? "--"}
        {value != null && unit && <span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span>}
      </p>
      {diff != null && Math.abs(diff) >= 0.1 && (
        <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${good ? "text-recovery" : "text-danger"}`}>
          {diff > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {Math.abs(Math.round(diff * 10) / 10)} vs 7-day avg
        </p>
      )}
    </div>
  );
}
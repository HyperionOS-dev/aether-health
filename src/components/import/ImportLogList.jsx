import { format } from "date-fns";
import Label from "@/components/dash/Label";

export default function ImportLogList({ logs }) {
  if (!logs?.length) return null;
  return (
    <div className="border-t border-hairline pt-4">
      <Label>Sync log</Label>
      <div className="mt-2 max-h-48 space-y-2 overflow-x-hidden overflow-y-auto">
        {logs.map((l) => (
          <div key={l.id} className="flex w-full min-w-0 items-center gap-3 text-sm">
            <span className={`h-2 w-2 shrink-0 rounded-full ${l.status === "success" ? "bg-recovery" : "bg-danger"}`} />
            <span className="min-w-0 flex-1 truncate" title={l.file_name}>{l.file_name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {l.status === "success" ? `${l.days_count || 0}d · ${l.workouts_count || 0}w` : "Failed"} · {format(new Date(l.created_date), "MMM d")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
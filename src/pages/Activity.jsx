import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import useHealthData from "@/hooks/useHealthData";
import { todayStr } from "@/lib/metrics";
import TopBar from "@/components/dash/TopBar";
import CalendarHeatmap from "@/components/dash/CalendarHeatmap";
import EmptyState from "@/components/dash/EmptyState";
import SyncFab from "@/components/dash/SyncFab";
import ImportPanel from "@/components/import/ImportPanel";
import LogWorkoutDialog from "@/components/workout/LogWorkoutDialog";

export default function Activity() {
  const { data, isLoading } = useHealthData();
  const [date, setDate] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.title = "Activity · Aether";
  }, []);

  const metrics = data?.metrics || [];
  const current = date || metrics.at(-1)?.date || todayStr();
  const allWorkouts = data?.workouts || [];
  const lastLog = data?.logs?.[0];

  return (
    <div className="min-h-screen overflow-x-clip bg-background pb-28">
      <TopBar date={current} onDate={setDate} lastLog={lastLog} />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap justify-end gap-2">
          {date && (
            <Link
              to={`/?date=${date}`}
              className="inline-flex items-center gap-1 rounded-xl border border-hairline bg-card px-3 py-2 text-xs font-semibold uppercase tracking-[1.5px] text-sleep hover:bg-surface"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open this day
            </Link>
          )}
          <LogWorkoutDialog />
        </div>
        {isLoading ? (
          <div className="flex justify-center py-32">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-recovery" />
          </div>
        ) : metrics.length === 0 ? (
          <EmptyState onImport={() => setOpen(true)} />
        ) : (
          <CalendarHeatmap metrics={metrics} workouts={allWorkouts} selected={current} onDate={setDate} />
        )}
      </main>
      <SyncFab onClick={() => setOpen(true)} lastLog={lastLog} />
      <ImportPanel open={open} onOpenChange={setOpen} logs={data?.logs} />
    </div>
  );
}
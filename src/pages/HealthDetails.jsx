import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import useHealthData from "@/hooks/useHealthData";
import { useIsMobile } from "@/hooks/use-mobile";
import { todayStr } from "@/lib/metrics";
import TopBar from "@/components/dash/TopBar";
import Hero from "@/components/dash/Hero";
import StrainCard from "@/components/dash/StrainCard";
import RecoveryCard from "@/components/dash/RecoveryCard";
import SleepCard from "@/components/dash/SleepCard";
import SegmentPills from "@/components/dash/SegmentPills";
import EmptyState from "@/components/dash/EmptyState";
import SyncFab from "@/components/dash/SyncFab";
import ImportPanel from "@/components/import/ImportPanel";
import LogWorkoutDialog from "@/components/workout/LogWorkoutDialog";
import BioAgeCard from "@/components/bioage/BioAgeCard";

export default function HealthDetails() {
  const { data, isLoading } = useHealthData();
  const isMobile = useIsMobile();
  // Date lives on the URL (?date=YYYY-MM-DD) so deep links / back button work.
  const [params, setParams] = useSearchParams();
  const [segment, setSegment] = useState("strain");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.title = "Home · Aether";
  }, []);

  const metrics = data?.metrics || [];
  const latest = metrics.at(-1)?.date || todayStr();
  const current = params.get("date") || latest;
  const setDate = (d) => setParams(d && d !== latest ? { date: d } : {});
  const day = metrics.find((m) => m.date === current);
  const history = metrics.filter((m) => m.date <= current).slice(-14);
  const workouts = (data?.workouts || []).filter((w) => w.date === current);
  const lastLog = data?.logs?.[0];

  const cards = {
    strain: <StrainCard key="strain" day={day} workouts={workouts} />,
    recovery: <RecoveryCard key="recovery" day={day} history={history} />,
    sleep: <SleepCard key="sleep" day={day} />,
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      <TopBar date={current} onDate={setDate} lastLog={lastLog} />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex justify-end">
          <LogWorkoutDialog />
        </div>
        {isLoading ? (
          <div className="flex justify-center py-32">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-recovery" />
          </div>
        ) : metrics.length === 0 ? (
          <EmptyState onImport={() => setOpen(true)} />
        ) : (
          <>
            {!day && (
              <p className="rounded-2xl border border-hairline bg-card p-4 text-sm text-muted-foreground">
                No Huawei Health data for this day yet.
              </p>
            )}
            <Hero day={day} history={history} />
            {isMobile ? (
              <div className="space-y-4">
                <SegmentPills value={segment} onChange={setSegment} />
                {cards[segment]}
              </div>
            ) : (
              <section className="grid gap-4 lg:grid-cols-3 md:grid-cols-2">
                {Object.values(cards)}
              </section>
            )}
            <BioAgeCard metrics={metrics} workouts={data?.workouts || []} />
          </>
        )}
      </main>
      <SyncFab onClick={() => setOpen(true)} lastLog={lastLog} />
      <ImportPanel open={open} onOpenChange={setOpen} logs={data?.logs} />
    </div>
  );
}
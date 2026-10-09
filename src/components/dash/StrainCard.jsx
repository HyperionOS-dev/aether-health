import { Activity } from "lucide-react";
import Card from "./Card";
import Label from "./Label";

const ZONES = ["Z1", "Z2", "Z3", "Z4", "Z5"];
const OPACITY = ["opacity-40", "opacity-55", "opacity-70", "opacity-85", "opacity-100"];

export default function StrainCard({ day, workouts }) {
  const zones = day?.zone_minutes?.length === 5 ? day.zone_minutes : [0, 0, 0, 0, 0];
  const maxZ = Math.max(...zones, 1);
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <Label>Day Strain</Label>
          <p className="font-display text-[32px] font-bold text-strain">{day?.strain ?? "--"}</p>
        </div>
        <span className="rounded-full border border-hairline px-3 py-1 text-xs text-muted-foreground">
          {day?.steps ? `${day.steps.toLocaleString()} steps` : "0 – 21 scale"}
        </span>
      </div>
      <Label className="mt-4">Heart rate zones</Label>
      <div className="mt-2 space-y-2">
        {zones.map((m, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className="w-6 text-muted-foreground">{ZONES[i]}</span>
            <div className="h-2 flex-1 rounded-full bg-surface">
              <div className={`h-2 rounded-full bg-strain ${OPACITY[i]}`} style={{ width: `${(m / maxZ) * 100}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums">{Math.round(m)}m</span>
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-hairline pt-4">
        <Label>Activities</Label>
        {workouts.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No workouts recorded this day.</p>}
        {workouts.map((w) => (
          <div key={w.id} className="mt-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface">
              <Activity className="h-4 w-4 text-strain" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{w.activity}</p>
              <p className="text-xs text-muted-foreground">
                {[w.start_time, w.duration_min && `${Math.round(w.duration_min)} min`, w.avg_hr && `${w.avg_hr} bpm`, w.calories && `${Math.round(w.calories)} kcal`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span className="rounded-full bg-strain/15 px-3 py-1 font-display text-sm font-bold text-strain">{w.strain ?? "--"}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
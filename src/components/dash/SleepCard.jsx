import Card from "./Card";
import Label from "./Label";
import { fmtHours } from "@/lib/metrics";

const STAGES = [
  { key: "awake_minutes", label: "Awake", cls: "bg-muted-foreground" },
  { key: "light_minutes", label: "Light", cls: "bg-sleep/40" },
  { key: "deep_minutes", label: "Deep", cls: "bg-sleep" },
  { key: "rem_minutes", label: "REM", cls: "bg-sleep/70" },
];

export default function SleepCard({ day }) {
  const total = STAGES.reduce((s, st) => s + (day?.[st.key] || 0), 0);
  const cons = day?.sleep_consistency ?? null;
  const variability = day?.sleep_duration_variability ?? null;
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <Label>Sleep Performance</Label>
          <p className="font-display text-[32px] font-bold text-sleep">
            {day?.sleep_performance != null ? `${day.sleep_performance}%` : "--"}
          </p>
        </div>
        <span className="rounded-full border border-hairline px-3 py-1 text-xs text-muted-foreground">
          {fmtHours(day?.sleep_hours)} / {fmtHours(day?.sleep_need)}
        </span>
      </div>
      <Label className="mt-4">Sleep stages</Label>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-surface">
        {total > 0 && STAGES.map((st) => (
          <div key={st.key} className={st.cls} style={{ width: `${((day?.[st.key] || 0) / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {STAGES.map((st) => (
          <div key={st.key}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${st.cls}`} />{st.label}
            </div>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{day?.[st.key] != null ? fmtHours(day[st.key] / 60) : "--"}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-hairline pt-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Consistency · 7 nights</Label>
            <p className="text-[10px] text-muted-foreground">How regular your bed and wake times are</p>
          </div>
          <span className="font-display text-lg font-bold">{cons != null ? `${cons}%` : "--"}</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-surface">
          <div className="h-2 rounded-full bg-sleep" style={{ width: `${cons || 0}%` }} />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Label>Duration variability</Label>
          <span className="text-sm font-semibold tabular-nums">{variability != null ? `± ${variability} min` : "--"}</span>
        </div>
      </div>
    </Card>
  );
}
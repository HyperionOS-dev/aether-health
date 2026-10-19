import Card from "./Card";
import Label from "./Label";
import { fmtHours } from "@/lib/metrics";

const STAGES = [
  { key: "awake_minutes", label: "Awake", cls: "bg-muted-foreground" },
  { key: "light_minutes", label: "Light", cls: "bg-sleep/40" },
  { key: "deep_minutes", label: "Deep", cls: "bg-sleep" },
  { key: "rem_minutes", label: "REM", cls: "bg-sleep/70" },
];

const previousDate = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export default function SleepCard({ day }) {
  const total = STAGES.reduce((s, st) => s + (day?.[st.key] || 0), 0);
  const cons = day?.sleep_consistency ?? null;
  const variability = day?.sleep_duration_variability ?? null;
  // Naps pay down the sleep need of the night they precede (SCORING_CONFIG.sleep.napNeedCredit).
  const napMinutes = Number.isFinite(day?.nap_minutes) && day.nap_minutes > 0 ? day.nap_minutes : 0;
  // The credit the scorer applied, in minutes. Days scored before that field existed
  // fall back to the gap between the unadjusted and adjusted need, which is 0.1 h coarse.
  const needCreditMinutes = Number.isFinite(day?.nap_need_credit_minutes)
    ? Math.max(0, Math.round(day.nap_need_credit_minutes))
    : day?.sleep_need_base != null && day?.sleep_need != null
      ? Math.max(0, Math.round((day.sleep_need_base - day.sleep_need) * 60))
      : 0;
  // The score carries the days the credited naps were taken on, so "nap yesterday" is only
  // claimed when that is what happened. Rows scored before that field existed keep the old
  // wording: the credit they could apply was always the previous day's nap.
  const credited = Array.isArray(day?.nap_need_credit_dates) ? day.nap_need_credit_dates : null;
  const napYesterday = credited == null
    ? true
    : credited.length > 0 && credited.every((date) => date === previousDate(day?.date));
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
      {napMinutes > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <Label>Naps</Label>
          <span className="text-sm font-semibold tabular-nums">{fmtHours(napMinutes / 60)}</span>
        </div>
      )}
      {needCreditMinutes > 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Need reduced by {fmtHours(needCreditMinutes / 60)}{napYesterday ? " (nap yesterday)" : ""}
        </p>
      )}
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
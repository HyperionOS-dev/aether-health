import { useState } from "react";
import { ChevronDown } from "lucide-react";
import FactorGauge from "./FactorGauge";

// Gauge ranges per factor. For RHR (lower is better) min > max so low values map to
// the teal (right) side.
const GAUGE = {
  sleep: { min: 5, max: 10, unit: "h" },
  consistency: { min: 40, max: 100, unit: "%" },
  rhr: { min: 85, max: 45, unit: "bpm" },
  steps: { min: 3000, max: 12000, unit: "" },
  activity: { min: 0, max: 400, unit: "min" },
};

const BODIES = {
  sleep: (s) =>
    s >= 0.3 ? "Your sleep duration is in a healthy range, helping lower your estimated age. Keep protecting those hours."
    : s <= -0.05 ? "Short nights are a drag here — aim for a steady 7-9h window."
    : "Sleep is around typical; nudging toward 7.5-8.5h would help.",
  consistency: (s) =>
    s >= 0.3 ? "Your bed/wake rhythm is steady, which helps keep your estimated age down."
    : s <= -0.05 ? "Irregular sleep timing is holding you back. Anchor a fixed wake time."
    : "Sleep timing is fairly typical — a consistent wake time would add stability.",
  rhr: (s) =>
    s >= 0.3 ? "A low resting heart rate reflects solid aerobic conditioning and recovery."
    : s <= -0.05 ? "Elevated resting HR suggests stress or under-recovery; prioritise sleep and easy aerobic work."
    : "Resting HR is typical for your profile.",
  steps: (s) =>
    s >= 0.3 ? "Daily movement is high, supporting metabolic and cardiovascular health."
    : s <= -0.05 ? "Low daily steps are the main drag — build in a daily walk."
    : "Steps are around typical; a daily walk would lift this factor.",
  activity: (s) =>
    s >= 0.3 ? "Weekly aerobic load is strong and a major contributor to a younger estimate."
    : s <= -0.05 ? "Weekly aerobic minutes are low — add sessions toward the 150-300 min/week guideline."
    : "Aerobic load is typical; one more brisk session a week would help.",
};

const statusOf = (s) => (s >= 0.3 ? "Outperforming" : s <= -0.05 ? "Needs work" : "On track");

export default function FactorRow({ factor, windowDays = 0 }) {
  const [open, setOpen] = useState(false);
  const excluded = factor.excluded || factor.value == null;
  const yrs = factor.yearsShown || 0;
  const g = GAUGE[factor.id];
  const N = Math.min(180, Math.max(0, windowDays || 0));
  const winVal = factor.value;
  const last30 = factor.trend?.last30 ?? null;
  const toneColor = yrs < 0 ? "#C9B5E8" : yrs > 0 ? "#FF5500" : "#A0A0A0";

  if (excluded) {
    return (
      <div className="rounded-xl border border-hairline bg-surface/40 p-4 opacity-60">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{factor.label}</span>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Collecting</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-hairline bg-surface/40 p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="text-sm font-medium">{factor.label}</span>
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums" style={{ color: toneColor }}>
            {yrs > 0 ? "+" : ""}{yrs.toFixed(1)} yrs
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      <div className="mt-3">
        <FactorGauge min={g.min} max={g.max} value={winVal} last30={last30} unit={g.unit} windowDays={N} />
      </div>

      {open && (
        <div className="mt-3 border-t border-hairline pt-3 text-sm">
          <p className="font-semibold text-foreground">{statusOf(factor.score)}</p>
          <p className="mt-1 text-muted-foreground">{BODIES[factor.id](factor.score)}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Avg – {N}d: <span className="text-foreground">{fmtVal(winVal, g.unit)}</span> · 30-day: <span className="text-foreground">{fmtVal(last30, g.unit)}</span> · Target: <span className="text-foreground">{fmtVal(factor.target, g.unit)}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function fmtVal(v, unit) {
  if (v == null) return "--";
  const n = Number.isInteger(v) || v >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
  return unit ? `${n} ${unit}` : `${n}`;
}
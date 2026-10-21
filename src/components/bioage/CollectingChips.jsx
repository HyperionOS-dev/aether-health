import { Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CONFIDENCE_FULL_DAYS, FACTORS, MIN_DAYS_PER_FACTOR, MIN_DAYS_UNLOCK, MIN_FACTORS_UNLOCK,
} from "@/lib/bioAgeConfig";

const MIN_DAYS = MIN_DAYS_UNLOCK;
// The chip always counts against the true total of five, so a full set can never read
// "5/4"; the four-factor unlock gate is stated in the popover instead.
const TOTAL_FACTORS = Object.keys(FACTORS).length;

// Two progress chips shown in the "Collecting data" state and under the blob once
// unlocked. Each turns lavender (sleep token) with a check once its threshold is met
// (28 days and 4 factors). The days chip opens a popover with the unlock minimum and
// the full-confidence target. The factors chip opens a popover listing every factor's
// valid days toward the 21-day minimum plus the 4-of-5 unlock minimum. Once unlocked,
// the days chip counts toward the 90-day target; the factors chip always counts toward
// all five factors.
export default function CollectingChips({ days = 0, factorCount = 0, factors = [], unlocked = false }) {
  const daysMet = days >= MIN_DAYS;
  const daysTarget = unlocked ? CONFIDENCE_FULL_DAYS : MIN_DAYS;
  const factorsMet = factorCount >= MIN_FACTORS_UNLOCK;
  const metCls = "border-sleep bg-sleep/15 text-sleep";
  const mutedCls = "border-hairline bg-surface text-muted-foreground hover:text-foreground";
  const dayRows = [
    { label: "Unlock minimum", target: MIN_DAYS, met: days >= MIN_DAYS },
    { label: "Full confidence", target: CONFIDENCE_FULL_DAYS, met: days >= CONFIDENCE_FULL_DAYS },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${days} of ${daysTarget} days collected`}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${daysMet ? metCls : mutedCls}`}
          >
            {daysMet && <Check className="h-3 w-3" />}
            {days}/{daysTarget} days
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 rounded-xl border-hairline bg-card p-3 text-card-foreground">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Days · collected
          </p>
          <ul className="space-y-1.5">
            {dayRows.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-foreground">
                  {r.label} <span className="text-muted-foreground">({r.target} days)</span>
                </span>
                <span className={`inline-flex shrink-0 items-center gap-1 ${r.met ? "text-sleep" : "text-muted-foreground"}`}>
                  {r.met && <Check className="h-3 w-3" />}
                  {days}/{r.target}
                </span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Factor data breakdown, ${factorCount} of ${TOTAL_FACTORS} factors ready`}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${factorsMet ? metCls : mutedCls}`}
          >
            {factorsMet && <Check className="h-3 w-3" />}
            {factorCount}/{TOTAL_FACTORS} factors
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 rounded-xl border-hairline bg-card p-3 text-card-foreground">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Factor · valid days
          </p>
          <ul className="space-y-1.5">
            {factors.map((f) => {
              const v = f.validDays || 0;
              const met = v >= MIN_DAYS_PER_FACTOR;
              return (
                <li key={f.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-foreground">{f.label}</span>
                  <span className={`inline-flex shrink-0 items-center gap-1 ${met ? "text-sleep" : "text-muted-foreground"}`}>
                    {met && <Check className="h-3 w-3" />}
                    {v}/{MIN_DAYS_PER_FACTOR}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 flex items-center gap-1.5 border-t border-hairline pt-2 text-[11px] text-muted-foreground">
            {factorsMet && <Check className="h-3 w-3 shrink-0 text-sleep" />}
            <span>Unlock minimum: {MIN_FACTORS_UNLOCK} of {TOTAL_FACTORS} factors</span>
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
import { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, Flame, Trophy, CalendarDays } from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameDay, isSameMonth, format, subMonths, addMonths, parseISO, isToday,
} from "date-fns";
import Card from "./Card";
import Label from "./Label";
import { dateLabel } from "@/lib/metrics";
import { intensityOf, levelFor, HEATMAP_CONFIG } from "@/lib/heatmapScale";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const ACTIVE_STRAIN = 5; // a day counts as "active" at this strain

// Absolute (legacy) mode: continuous tint up to a hard training day (strain 13+).
const FULL_STRAIN = 13;
function strainOpacity(strain) {
  if (strain == null) return 0;
  return 0.12 + Math.pow(Math.min(1, Math.max(0, strain) / FULL_STRAIN), 0.55) * 0.88;
}

// Relative mode: one tint per intensity level.
const LEVEL_OPACITY = { none: 0, L1: 0.28, L2: 0.5, L3: 0.72, L4: 1.0 };
const LEVEL_ORDER = ["none", "L1", "L2", "L3", "L4"];

const MODE_KEY = "aether.heatmap.mode";

export default function CalendarHeatmap({ metrics, workouts, selected, onDate }) {
  const [cursor, setCursor] = useState(new Date());
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || "relative");
  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  const byDate = useMemo(() => {
    const m = new Map();
    metrics.forEach((d) => m.set(d.date, d));
    return m;
  }, [metrics]);

  // Strain history, ascending by date — the trailing 30-day windows read off this.
  const strainHistory = useMemo(
    () =>
      metrics
        .filter((d) => d.strain != null)
        .map((d) => ({ date: d.date, strain: d.strain }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [metrics],
  );

  const workoutDates = useMemo(() => {
    const s = new Set();
    workouts.forEach((w) => s.add(w.date));
    return s;
  }, [workouts]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const streaks = useMemo(() => {
    const sorted = [...metrics].filter((d) => (d.strain ?? 0) >= ACTIVE_STRAIN).sort((a, b) => a.date.localeCompare(b.date));
    if (!sorted.length) return { current: 0, longest: 0, monthActive: 0 };

    let longest = 1, run = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = parseISO(sorted[i - 1].date);
      const cur = parseISO(sorted[i].date);
      const gap = Math.round((cur - prev) / 86400000);
      if (gap === 1) run++;
      else { longest = Math.max(longest, run); run = 1; }
    }
    longest = Math.max(longest, run);

    const today = new Date();
    let current = 0;
    let probe = today;
    while (true) {
      const key = format(probe, "yyyy-MM-dd");
      const d = byDate.get(key);
      if (d && (d.strain ?? 0) >= ACTIVE_STRAIN) {
        current++;
        probe = new Date(probe.getTime() - 86400000);
      } else break;
    }

    const monthActive = sorted.filter((d) => isSameMonth(parseISO(d.date), cursor)).length;
    return { current, longest, monthActive };
  }, [metrics, byDate, cursor]);

  // Relative-mode metrics for one cell. The window excludes the day itself, so it
  // never repaints when new data lands further along.
  const cellRel = (key, strain) => {
    if (strain == null) return null;
    const win = strainHistory
      .filter((d) => d.date < key)
      .slice(-HEATMAP_CONFIG.windowSize)
      .map((d) => d.strain);
    const { intensity, rel } = intensityOf(strain, win);
    return { level: levelFor(intensity), pct: Math.round(rel * 100) };
  };

  const cellOpacity = (key, strain) => {
    if (strain == null) return 0;
    return mode === "absolute" ? strainOpacity(strain) : LEVEL_OPACITY[cellRel(key, strain)?.level ?? "none"];
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>Activity Heatmap</Label>
          <p className="font-display text-lg font-bold capitalize">{format(cursor, "MMMM yyyy")}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCursor(subMonths(cursor, 1))} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setCursor(new Date())} className="rounded-lg px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-surface">
            Today
          </button>
          <button onClick={() => setCursor(addMonths(cursor, 1))} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{d}</div>
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const m = byDate.get(key);
          const strain = m?.strain;
          const hasWorkout = workoutDates.has(key);
          const inMonth = isSameMonth(day, cursor);
          const isSel = selected && isSameDay(parseISO(selected), day);
          const op = cellOpacity(key, strain);
          const rel = mode === "relative" && strain != null ? cellRel(key, strain) : null;
          const tip = m
            ? mode === "relative"
              ? `${dateLabel(key)} · Strain ${strain ?? "--"} · ${rel ? `${rel.pct}% of your typical hard day` : "--"} · Recovery ${m.recovery ?? "--"}%`
              : `${dateLabel(key)} · Strain ${strain ?? "--"} · Recovery ${m.recovery ?? "--"}%`
            : key;
          return (
            <button
              key={key}
              onClick={() => onDate?.(key)}
              className={`relative aspect-square rounded-lg border text-[11px] font-medium transition-all hover:ring-1 hover:ring-sleep/60 ${
                isSel ? "border-sleep ring-1 ring-sleep" : "border-hairline"
              } ${inMonth ? "" : "opacity-30"}`}
              style={strain != null ? { backgroundColor: `rgba(201, 181, 232, ${op})` } : undefined}
              title={tip}
            >
              <span className={`absolute left-1 top-0.5 ${isToday(day) ? "text-sleep font-bold" : "text-foreground/80"}`}>
                {format(day, "d")}
              </span>
              {hasWorkout && (
                <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-strain shadow-[0_0_6px_hsl(var(--strain))]" />
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-hairline pt-4">
        <Stat icon={<Flame className="h-4 w-4 text-strain" />} label="Current Streak" value={`${streaks.current}d`} />
        <Stat icon={<Trophy className="h-4 w-4 text-sleep" />} label="Longest Streak" value={`${streaks.longest}d`} />
        <Stat icon={<CalendarDays className="h-4 w-4 text-recovery" />} label="Active This Month" value={`${streaks.monthActive}d`} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4">
        <div className="flex items-center gap-1 rounded-full border border-hairline bg-card p-1">
          {[["relative", "Relative"], ["absolute", "Absolute"]].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                mode === id ? "bg-sleep text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Less</span>
          {mode === "absolute"
            ? [1, 4, 7, 10, 13].map((s) => (
                <span key={s} className="h-3 w-3 rounded" style={{ backgroundColor: `rgba(201, 181, 232, ${strainOpacity(s)})` }} />
              ))
            : LEVEL_ORDER.map((lv) => (
                <span
                  key={lv}
                  className={`h-3 w-3 rounded ${lv === "none" ? "border border-hairline bg-card" : ""}`}
                  style={lv === "none" ? undefined : { backgroundColor: `rgba(201, 181, 232, ${LEVEL_OPACITY[lv]})` }}
                />
              ))}
          <span>More</span>
          {mode === "relative" && <span className="ml-1 italic">Relative to your last 30 days</span>}
        </div>
      </div>
    </Card>
  );
}

function Stat({ icon, label, value }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-surface/50 p-3 text-center">
      {icon}
      <span className="font-display text-xl font-bold">{value}</span>
      <Label>{label}</Label>
    </div>
  );
}
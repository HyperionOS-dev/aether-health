import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { SCORING_CONFIG } from "@/lib/scoring/config";

// SVG/chart strokes need literal colors (they mirror the CSS tokens)
export const COLORS = {
  strain: "#FF5500",
  recovery: "#00E676",
  sleep: "#C9B5E8",
  caution: "#FFD600",
  danger: "#FF3B30",
  hairline: "#262C3D",
  muted: "#8B94A7",
};

const r1 = (v) => Math.round(v * 10) / 10;

export function recoveryTone(v) {
  if (v == null) return { label: "No data", color: COLORS.muted };
  if (v >= SCORING_CONFIG.recoveryV6.greenAt) return { label: "Recovered", color: COLORS.recovery };
  if (v >= SCORING_CONFIG.recoveryV6.yellowAt) return { label: "Recovering", color: COLORS.caution };
  return { label: "Needs rest", color: COLORS.danger };
}

export function strainTarget(r) {
  if (r >= 67) return r1(14 + ((r - 67) / 33) * 4);
  if (r >= 34) return r1(10 + ((r - 34) / 33) * 4);
  return r1(6 + (r / 34) * 4);
}

export function insight(day) {
  const r = day?.recovery;
  if (r == null) return { title: "Awaiting data", body: "Import health data to calculate your current Recovery." };
  if (r >= 85) return { title: "Recovered", body: "Your current recovery is high. Workout debt and body signals are both within the recovered range." };
  if (r >= 60) return { title: "Building back", body: "Your recovery is moving upward. Rest and a normal night of sleep are included in the estimate." };
  return { title: "Recovery in progress", body: "Workout debt or body signals are still lowering your current recovery." };
}

export function avg(rows, key) {
  const v = rows.map((r) => r[key]).filter((x) => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function consistency(rows) {
  const v = rows.slice(-7).map((r) => r.sleep_hours).filter((x) => typeof x === "number");
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  return Math.round(Math.max(0, Math.min(100, 100 - sd * 30)));
}

export const fmtHours = (h) => (h == null ? "--" : `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`);

export const todayStr = () => format(new Date(), "yyyy-MM-dd");

export function dateLabel(date) {
  const diff = differenceInCalendarDays(new Date(), parseISO(date));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return format(parseISO(date), "EEE, MMM d");
}

// BRS v1.2: the clock time "Back to 100% around ..." points at. A debt-only estimate can land
// on a later day, so the weekday is included whenever the target is not today ("Fri 2:13 am"),
// and a same-day target stays a bare clock time ("2:13 am").
/**
 * @param {number} ms target instant
 * @param {string} timezone
 * @param {{ now?: number, locale?: string }} [options] locale is for tests only; the app keeps the browser default
 */
export function recoveryEtaLabel(ms, timezone, { now = Date.now(), locale } = {}) {
  if (!Number.isFinite(ms)) return null;
  const dayKey = new Intl.DateTimeFormat(locale, { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const clock = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(ms).toLowerCase();
  if (dayKey.format(ms) === dayKey.format(now)) return clock;
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short" }).format(ms);
  return `${weekday} ${clock}`;
}
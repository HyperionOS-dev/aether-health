import { format, parseISO, differenceInCalendarDays } from "date-fns";

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
  if (v >= 67) return { label: "Green", color: COLORS.recovery };
  if (v >= 34) return { label: "Yellow", color: COLORS.caution };
  return { label: "Red", color: COLORS.danger };
}

export function strainTarget(r) {
  if (r >= 67) return r1(14 + ((r - 67) / 33) * 4);
  if (r >= 34) return r1(10 + ((r - 34) / 33) * 4);
  return r1(6 + (r / 34) * 4);
}

export function insight(day) {
  const r = day?.recovery;
  if (r == null) return { title: "Awaiting data", body: "Import Huawei Health data with HRV or resting heart rate to calculate your Recovery." };
  const t = strainTarget(r);
  if (r >= 67) return { title: "Optimal Health", body: `Take advantage of your green Recovery by meeting your Strain target of ${t}. Your body is signaling it can take on significant exertion today.` };
  if (r >= 34) return { title: "Maintain", body: `Your Recovery is in the yellow. Aim for a moderate Strain target of ${t} and prioritize quality sleep tonight.` };
  return { title: "Rest & Recover", body: `Your body is under stress. Keep Strain under ${t} with active recovery, hydration and an early bedtime.` };
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
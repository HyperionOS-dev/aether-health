// Adaptive heatmap intensity: one pure place where a day's value becomes a
// 0..1 score and a level (none / L1..L4). Two modes share the same level cuts:
//   - relative: blends a value against the user's own recent hard day (p90 of the
//     trailing 30 real days) with an absolute floor, weighted by how much history
//     exists. The window is strictly trailing (never includes the day itself), so
//     past cells never repaint when new data arrives.
//   - absolute: the legacy curve — value / 21 — exposed here so both modes read
//     from the same constants.
//
// CalendarHeatmap colours by day *strain* (0..21), so every constant below is in
// strain points.

export const HEATMAP_CONFIG = {
  windowSize: 30, // trailing real days that form the personal baseline
  floor: 6, // FLOOR: the p90 is never allowed below this strain
  maxStrain: 21, // absolute scale ceiling
  p90: 0.9, // percentile of the window that counts as "your typical hard day"
  alpha: 0.7, // max weight of the relative term once confidence is full
  minConfidencePairs: 7, // fewer real days than this and only the absolute term is used
};

export const LEVELS = [
  { id: "none", max: 0.04 },
  { id: "L1", max: 0.2 },
  { id: "L2", max: 0.4 },
  { id: "L3", max: 0.7 },
  { id: "L4", max: Infinity },
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo); // linear interpolation
}

// The 30 real days BEFORE `date` that carry a strain. Missing / not-worn days are
// skipped (never counted as zero); a real rest day with data still counts as 0.
export function trailingWindow(history, date) {
  return history
    .filter((d) => d.date < date && d.strain != null)
    .slice(-HEATMAP_CONFIG.windowSize);
}

// Core scoring for one day. `windowValues` = the strains of the trailing real days
// (see trailingWindow). Returns the 0..1 intensity plus every term that feeds it,
// so the UI can label a cell "% of your typical hard day".
export function intensityOf(value, windowValues) {
  const n = windowValues.length;
  const conf = Math.min(1, n / HEATMAP_CONFIG.windowSize);
  const p90 = percentile(windowValues, HEATMAP_CONFIG.p90);
  const denom = Math.max(p90, HEATMAP_CONFIG.floor);
  const rel = clamp(value / denom, 0, 1);
  const abs = clamp(value / HEATMAP_CONFIG.maxStrain, 0, 1);
  // Not enough personal history → absolute only, so early days behave like the
  // legacy scale instead of being ruled by a handful of noisy readings.
  const alpha = n < HEATMAP_CONFIG.minConfidencePairs ? 0 : HEATMAP_CONFIG.alpha * conf;
  return { intensity: alpha * rel + (1 - alpha) * abs, conf, p90, denom, n, rel, abs };
}

// Absolute (legacy) intensity: strain as a share of the 0..21 scale.
export function absoluteIntensity(value) {
  return clamp(value / HEATMAP_CONFIG.maxStrain, 0, 1);
}

export function levelFor(intensity) {
  for (const l of LEVELS) if (intensity < l.max) return l.id;
  return "L4";
}
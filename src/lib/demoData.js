// In-memory demo data for ?demo=1 / ?demo=sparse. Seeded (mulberry32) so it looks the
// same every load, generated entirely in the browser — never written to any entity,
// localStorage snapshot, or the daily bio-age snapshot. Shapes match DailyMetric /
// Workout records so the heatmap and Biological Age card consume them unchanged.

const SEED = 1337;
const round1 = (v) => Math.round(v * 10) / 10;
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-kind HR-zone minutes for the day's OWN trace (outside any session).
const ZONES = {
  rest: [55, 14, 3, 0, 0],
  walk: [40, 32, 12, 2, 0],
  hard: [22, 38, 46, 26, 7],
};

export const DEMO_AGE = 32;

export function demoParam() {
  try {
    const v = new URLSearchParams(window.location.search).get("demo");
    if (v === "1") return "1";
    if (v === "sparse") return "sparse";
  } catch {
    /* no window */
  }
  return null;
}

export function getDemoData(mode) {
  const n = mode === "sparse" ? 20 : 120;
  const rnd = mulberry32(SEED);
  const metrics = [];
  const workouts = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const date = ymd(d);
    const idx = n - 1 - i; // ascending 0..n-1
    const r = rnd();
    const kind = r > 0.82 ? "hard" : r > 0.45 ? "walk" : "rest";
    const isBadminton = idx % 5 === 0 && mode !== "sparse";

    let strain =
      kind === "rest" ? 2 + Math.round(rnd() * 3) : kind === "walk" ? 6 + Math.round(rnd() * 3) : 13 + Math.round(rnd() * 6);
    const sh = Math.max(5.5, Math.min(9.5, 7.2 + (kind === "rest" ? 0.9 : kind === "walk" ? 0.3 : -0.5) + (rnd() - 0.5) * 1.1));
    const consistency = Math.round(56 + rnd() * 37);
    const resting_hr = Math.round(54 + (kind === "hard" ? 6 : kind === "walk" ? 2 : 0) + rnd() * 4);
    const stepsBase = kind === "rest" ? 3600 : kind === "walk" ? 8200 : 10500;
    const steps = Math.round(stepsBase + (rnd() - 0.5) * 2400);

    let residual = ZONES[kind].slice();
    let zone_minutes = residual.slice();

    if (isBadminton) {
      const zW = [5, 20, 25, 8, 2]; // 60-min session, own per-second stream
      residual = residual.map((v, j) => Math.max(0, Math.round(v * 0.7 - zW[j] * 0.2)));
      zone_minutes = residual.map((v, j) => v + zW[j]);
      strain = Math.min(21, strain + 5);
      workouts.push({
        date,
        activity: "Badminton",
        start_time: "18:30",
        duration_min: 60,
        avg_hr: 145,
        max_hr: 176,
        min_hr: 78,
        strain: 14 + Math.round(rnd() * 5),
        is_outdoor: false,
        method: "hr_zones",
        zone_minutes: zW,
        source: "demo",
      });
    }

    // Recovery and the next-day projection it carries forward, mirroring the
    // real model: the projection is withheld until ≥5 rest-day pairs exist, so the
    // first few demo days show the "still learning" state.
    const recovery = Math.round(45 + rnd() * 45);
    const recovery_rate_pairs = Math.min(20, Math.max(0, idx - 4));
    const learned = recovery_rate_pairs >= 5;
    const recovery_rate = learned ? Math.round(40 + rnd() * 80) / 10 : null; // ~4-12 pts/rest-day
    const recovery_rate_spread = learned ? Math.round(20 + rnd() * 40) / 10 : null; // ~2-6 pts
    const recovery_projection =
      learned && recovery_rate != null ? Math.min(99, Math.max(1, Math.round(recovery + recovery_rate))) : null;
    const recovery_projection_low =
      learned && recovery_projection != null && recovery_rate_spread != null
        ? Math.max(1, Math.round(recovery_projection - recovery_rate_spread))
        : null;
    const recovery_projection_high =
      learned && recovery_projection != null && recovery_rate_spread != null
        ? Math.min(99, Math.round(recovery_projection + recovery_rate_spread))
        : null;

    metrics.push({
      date,
      strain,
      sleep_hours: round1(sh),
      sleep_minutes: Math.round(sh * 60),
      deep_minutes: Math.round(sh * 60 * 0.2),
      light_minutes: Math.round(sh * 60 * 0.5),
      rem_minutes: Math.round(sh * 60 * 0.25),
      awake_minutes: Math.round(sh * 6),
      sleep_consistency: consistency,
      resting_hr,
      steps,
      zone_minutes,
      zone_minutes_residual: residual,
      hr_covered: true,
      recovery,
      recovery_rate,
      recovery_rate_spread,
      recovery_rate_pairs,
      recovery_projection,
      recovery_projection_low,
      recovery_projection_high,
      sleep_performance: Math.round(62 + rnd() * 35),
      hrv: Math.round(28 + rnd() * 45),
      skin_temp: round1(33 + rnd() * 2), // wrist skin temp ~33-35 °C
      respiratory_rate: 12 + Math.round(rnd() * 8), // 12-20 rpm
      calories: Math.round(1800 + rnd() * 900),
      source: "demo",
    });
  }
  return { metrics, workouts, logs: [] };
}
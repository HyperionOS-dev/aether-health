// Biological Age configuration. Every threshold below is a PLACEHOLDER lifestyle
// anchor, not a clinical cut-off — replace each with a cited value before relying on
// it. Scoring is guideline-threshold based, never population-averaged.
//
// Sources to cite when replacing placeholders:
//   sleep duration  — AASM / National Sleep Foundation adult recommendation (~7-9h)
//   sleep consistency — derived bed/wake regularity score (this app's own metric)
//   resting HR      — general adult resting-HR ranges (ACP / cardiology texts)
//   steps/day       — common step-count guidelines (~6000-10000)
//   weekly aerobic  — WHO: 150-300 min/week moderate-intensity activity

export const BIO_AGE_CONFIG_VERSION = "bioage-v1-placeholder";

// Total years delta vs actual age is clamped to +/- this.
export const MAX_TOTAL_YEARS = 10;

// Confidence reaches 1.0 at this many days of data; before that the estimate is
// labelled "Early estimate" and the years are scaled down.
export const CONFIDENCE_FULL_DAYS = 90;

// Window of historical day metrics used to compute every factor.
export const WINDOW_DAYS = 180;

// Unlock gate: need this many days and this many valid factors.
export const MIN_DAYS_UNLOCK = 28;
export const MIN_FACTORS_UNLOCK = 4;
// A single factor needs at least this many valid days or it is excluded.
export const MIN_DAYS_PER_FACTOR = 21;

// Piecewise-linear anchors: [value, score]. +1 = at/beyond recommended, 0 = typical,
// -1 = clearly poor. years_f = -score * maxYears (negative years => younger).
export const FACTORS = {
  sleep: {
    label: "Sleep duration",
    unit: "hrs",
    target: 8.5,
    maxYears: 2,
    anchors: [[5, -1], [6.5, -0.3], [7.5, 0.8], [8.5, 1], [9.5, 0.2], [10.5, -0.6]],
  },
  consistency: {
    label: "Sleep consistency",
    unit: "/100",
    target: 90,
    maxYears: 1.5,
    anchors: [[50, -1], [75, 0], [90, 1]],
  },
  rhr: {
    label: "Resting heart rate",
    unit: "bpm",
    target: 55, // lower is better
    maxYears: 2.5,
    anchors: [[85, -1], [70, 0], [55, 1]],
  },
  steps: {
    label: "Daily steps",
    unit: "steps/day",
    target: 9000,
    maxYears: 2,
    anchors: [[3000, -1], [6000, 0], [9000, 1]],
  },
  activity: {
    label: "Weekly aerobic",
    unit: "min/week",
    target: 300, // WHO: 150-300 moderate min/week (placeholder)
    maxYears: 2.5,
    anchors: [[0, -1], [100, 0], [300, 1]],
  },
};

// PLACEHOLDER age-banded anchors (source: AASM / National Sleep Foundation — adults
// ~7-9h, adolescents ~8-10h). Only sleep duration is banded for now; every other factor
// uses one anchor set at every age. Nothing is locked or hidden at any age — both bands
// compute all five factors.
//   adult   sleep: [5,-1] [6.5,-0.3] [7.5,0.8] [8.5,1] [9.5,0.2] [10.5,-0.6]
//   under18 sleep: [6,-1] [7.5,-0.3] [8.5,0.8] [9.5,1] [10.5,0.2] [11.5,-0.6]
export const AGE_BANDS = {
  adult: {
    sleep: [[5, -1], [6.5, -0.3], [7.5, 0.8], [8.5, 1], [9.5, 0.2], [10.5, -0.6]],
  },
  under18: {
    sleep: [[6, -1], [7.5, -0.3], [8.5, 0.8], [9.5, 1], [10.5, 0.2], [11.5, -0.6]],
  },
};

export function bandFor(age) {
  return age != null && age < 18 ? "under18" : "adult";
}

export function factorAnchors(factorId, age) {
  const band = AGE_BANDS[bandFor(age)];
  return (band && band[factorId]) || FACTORS[factorId].anchors;
}

// Piecewise-linear interpolation of anchors -> score, clamped to [-1, 1].
export function factorScore(anchors, x) {
  if (x == null || !Number.isFinite(x)) return null;
  const a = [...anchors].sort((p, q) => p[0] - q[0]);
  if (x <= a[0][0]) return a[0][1];
  if (x >= a[a.length - 1][0]) return a[a.length - 1][1];
  for (let i = 1; i < a.length; i++) {
    const [x0, s0] = a[i - 1];
    const [x1, s1] = a[i];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return s0 + (s1 - s0) * t;
    }
  }
  return a[a.length - 1][1];
}
// The sleep-consistency window is nights only (SCORING_CONFIG.sleep.minNightMinutes).
//
// Both importers file the day's largest sleep cluster as the night, so a day whose only
// recorded sleep is a nap carries that nap in sleep_start/sleep_end. anchorMinutes() reads a
// clock time as minutes from noon, so an afternoon nap lands half a day away from every real
// night: one such row pushed sd(bed) + sd(wake) past 400, and sleep_consistency was stored as
// 0 for that day and the six nights after it. The window now drops a row only when it can be
// measured as shorter than a night — sleep_minutes (else deep + light + rem, else
// sleep_hours * 60) below minNightMinutes. A row with no minute count at all stays in.
//
// Two stored fields read that window and nothing else moved with it:
//   sleep_consistency          = sleepConsistency(nights)
//   sleep_duration_variability = durationVariability(nights)
// Recovery, sleep_hours, sleep_performance, strain and the nap credit read the day's own row
// or the workout list, never `nights`, so they are byte-identical with and without a nap row
// (the last test pins them to values captured before this change).
import test from "node:test";
import assert from "node:assert/strict";
import { ALGO_VERSION, computeScores, durationVariability, sleepConsistency } from "./scores.js";
import { SCORING_CONFIG } from "./config.js";

const MIN_NIGHT_MINUTES = SCORING_CONFIG.sleep.minNightMinutes; // untuned guess
const round1 = (v) => Math.round(v * 10) / 10;
const date = (index, month) => new Date(Date.UTC(2026, month, 1 + index)).toISOString().slice(0, 10);

// A stored row: the previous scoring run wrote sleep_hours, so both counts are on the row.
const row = (d, extra = {}) => {
  const base = {
    date: d, timezone: "UTC", hrv: 50, hrv_samples_count: 20, resting_hr: 60, rhr_samples_count: 100,
    sleep_minutes: 450, sleep_start: `${d}T23:00`, sleep_end: `${d}T07:00`, ...extra,
  };
  return { ...base, sleep_hours: round1(base.sleep_minutes / 60) };
};

const night = (d, bed, wake, extra = {}) => row(d, { sleep_start: `${d}T${bed}`, sleep_end: `${d}T${wake}`, ...extra });

// The shape the importers write when the day's only recorded sleep is a nap: the nap window in
// sleep_start/sleep_end and the nap's own staged minutes as the day's sleep.
const napOnly = (d) => row(d, {
  sleep_start: `${d}T14:05`, sleep_end: `${d}T14:35`, sleep_minutes: 25,
  deep_minutes: 8, light_minutes: 14, rem_minutes: 3,
});

const consistencyOf = (rows) => {
  const last = rows.at(-1).date;
  return computeScores(rows, [], [last]).get(last).sleep_consistency;
};
const variabilityOf = (rows) => {
  const last = rows.at(-1).date;
  return computeScores(rows, [], [last]).get(last).sleep_duration_variability;
};

const WEEK = [["22:45", "06:30"], ["23:10", "07:05"], ["23:30", "07:40"], ["00:05", "06:15"], ["23:50", "08:20"], ["00:40", "09:10"], ["02:10", "05:45"]];
const TIGHT = [["23:00", "07:00"], ["23:05", "07:00"], ["22:55", "06:55"], ["23:10", "07:05"], ["23:00", "07:00"], ["22:50", "06:50"]];

// One nap row ahead of the six tight nights, so it sits in the scored day's window without
// replacing a night the sample needs.
const tightSix = (month, offset = 0) => TIGHT.map(([bed, wake], i) => night(date(i + offset, month), bed, wake));
const tightSixPlusNap = (month) => [napOnly(date(0, month)), ...tightSix(month, 1)];

test("the night floor is a documented untuned 180-minute guess and the stored stamp stays put", () => {
  assert.equal(MIN_NIGHT_MINUTES, 180); // untuned guess
  assert.equal(SCORING_CONFIG.sleep.consistencyNights, 7);
  assert.equal(ALGO_VERSION, "aether-scores-v6");
});

test("the stated realistic week (beds 22:45-02:10, wakes 05:45-09:30) scores 65", () => {
  const week = WEEK.map(([bed, wake], i) => night(date(i, 0), bed, wake));
  assert.equal(sleepConsistency(week), 65);
  assert.equal(consistencyOf(week), 65); // and the stored field agrees
});

test("six tight nights read 97 with a nap-only row in the window and 97 without it", () => {
  const tight = tightSix(1);
  const withNap = tightSixPlusNap(1);
  assert.equal(consistencyOf(tight), 97);
  assert.equal(consistencyOf(withNap), 97);
  assert.equal(consistencyOf(withNap), consistencyOf(tight)); // the same six nights, same score
  assert.equal(consistencyOf(withNap), sleepConsistency(tight)); // the nap row is not in the sample
  assert.equal(variabilityOf(withNap), durationVariability(tight));
  assert.notEqual(consistencyOf(withNap), 0); // what it stored for those days before this change
  // The nap row still counts as the day's own sleep for every field that reads the row.
  const napDay = computeScores(withNap, [], [date(0, 1)]).get(date(0, 1));
  assert.equal(napDay.sleep_hours, 0.4);
});

test("2 h 50 is treated as a nap and 3 h 10 as a night (documented behaviour)", () => {
  const shortNight = (minutes, from, to) => [
    night(date(0, 2), from, to, { sleep_minutes: minutes }),
    ...tightSix(2, 1),
  ];
  const twoFifty = shortNight(170, "03:00", "05:50");
  const threeTen = shortNight(190, "02:00", "05:10");
  assert.ok(170 < MIN_NIGHT_MINUTES && MIN_NIGHT_MINUTES <= 190);
  // 2 h 50 is below the floor: it is a nap, so the window is still the six tight nights.
  assert.equal(consistencyOf(twoFifty), 97);
  assert.equal(consistencyOf(twoFifty), consistencyOf(twoFifty.slice(1)));
  // 3 h 10 is a night, so it joins the window and moves the score.
  assert.equal(consistencyOf(threeTen), 73);
  assert.equal(consistencyOf(threeTen), sleepConsistency([threeTen[0], ...tightSix(2, 1)]));
  assert.notEqual(consistencyOf(threeTen), consistencyOf(tightSix(2, 1)));
});

test("a row with a sleep window but no minute counts stays in the window", () => {
  // A night whose stages are all unknown: the importers write sleep_unknown_minutes and leave
  // sleep_minutes, the stage fields and sleep_hours empty. There is nothing to measure it with,
  // so it cannot be proved to be a nap and it keeps its place, as it did before this rule.
  const d = date(0, 4);
  const unknown = {
    date: d, timezone: "UTC", hrv: 50, hrv_samples_count: 20, resting_hr: 60, rhr_samples_count: 100,
    sleep_start: `${d}T02:00`, sleep_end: `${d}T10:00`, sleep_unknown_minutes: 480,
  };
  const rows = [unknown, ...tightSix(4, 1)];
  assert.equal(consistencyOf(rows), sleepConsistency(rows)); // the same seven rows
  assert.equal(consistencyOf(rows), 66); // the number this window produced before the rule
  assert.notEqual(consistencyOf(rows), consistencyOf(tightSix(4, 1))); // and it counted
});

test("fewer than two qualifying nights has no number at all", () => {
  const oneNight = [night(date(0, 3), "23:00", "07:00")];
  const onePlusNaps = [oneNight[0], ...[1, 2, 3, 4, 5, 6].map((i) => napOnly(date(i, 3)))];
  const allNaps = [0, 1, 2, 3, 4, 5, 6].map((i) => napOnly(date(i, 3)));
  assert.equal(consistencyOf(onePlusNaps), null);
  // Seven identical naps used to read as a perfectly consistent 100: the window took whatever
  // rows were there. A nap-only history now has no nights to compare, so it has no number.
  assert.equal(consistencyOf(allNaps), null);
  assert.equal(sleepConsistency(oneNight), null); // the two-night floor is unchanged
  assert.equal(durationVariability(oneNight), null);
  assert.equal(sleepConsistency(tightSix(3).slice(0, 2)), 99);
});

// --- what the window change must not touch ------------------------------------------------
// One fixed 37-day dataset: 30 flat nights, a week with real anchors, the third of those rows
// a nap-only row (2026-04-02) and a badminton session the evening before the last day. Every
// value below was captured from the scoring module before this change; the old and the new
// module return them identically. The only fields that moved on this dataset are the two that
// read `nights`: sleep_consistency 0 -> 64 and sleep_duration_variability 150 -> 11.
const DATES = Array.from({ length: 37 }, (_, i) => date(i, 2)); // 2026-03-01 .. 2026-04-06
const LAST_DAY = DATES.at(-1);
const NAP_DAY = DATES[32]; // 2026-04-02
const stored = (d, extra = {}) => row(d, { steps: 8000, hr_covered: false, ...extra });
const DATASET = [
  ...DATES.slice(0, 30).map((d) => stored(d)),
  ...WEEK.map(([bed, wake], i) => {
    const d = DATES[30 + i];
    return i === 2
      ? napOnly(d)
      : stored(d, { sleep_start: `${d}T${bed}`, sleep_end: `${d}T${wake}`, sleep_minutes: 420 });
  }),
];
const SESSIONS = [{
  date: DATES[35], activity: "Badminton", ended_at: `${DATES[35]}T20:00:00.000Z`,
  recovery_time_min: 900, duration_min: 60, avg_hr: 145, strain: 12,
}];

const GOLDEN = {
  recovery: 90,
  recovery_provisional: false,
  recovery_status: "3h to full",
  workout_debt: 10.5,
  physio_penalty: 0,
  time_to_full_hours: 3,
  sleep_hours: 7,
  sleep_need: 8.2,
  sleep_need_base: 8.2,
  sleep_performance: 85,
  sleep_performance_base: 85,
  strain: 2.6,
  nap_need_credit_minutes: 0,
};

const GOLDEN_COMPONENTS = {
  // rhr_z is a signed -0 here: r2() of a small negative z. Stored as -0 by the scorer, so the
  // golden keeps it exactly as the module returns it.
  hrv: 50, hrv_z: 0, rhr: 60, rhr_z: -0, sleep_perf: 85, sleep_z: 0, zc: 0, v5_composite_z: 0,
  old_v4_score: null, new_v5_score: null, hrv_for_90: null, hrv_for_99: null,
  hrv_sample_count: 20, rhr_sample_count: 100, sleep_session_ended: true,
  hrv_baseline: 50, hrv_sd_eff: 2.5, hrv_baseline_n: 30,
  rhr_baseline: 60, rhr_sd_eff: 2.5, rhr_baseline_n: 30,
  workout_debt: 10.5, physio_penalty: 0,
  debt_sessions: [{ activity: "Badminton", end_time: "2026-04-05T20:00:00.000Z", debt: 10.5 }],
  personal_speed: 1, personal_speed_label: "Using your watch's estimate",
  personal_speed_workout_days: 1, snapshot_at: "2026-04-06T08:00:00.000Z",
};

test("Recovery, sleep hours and Sleep Performance are byte-identical with a nap row in the window", () => {
  const scored = computeScores(DATASET, SESSIONS, [LAST_DAY]).get(LAST_DAY);
  assert.deepEqual(
    Object.fromEntries(Object.keys(GOLDEN).map((key) => [key, scored[key]])),
    GOLDEN,
  );
  assert.deepEqual(scored.recovery_components, GOLDEN_COMPONENTS);
  // The two window fields, healed: the nap row is out of the sample, so the nights around it
  // are compared (these were 0 and 150 before this change).
  assert.equal(scored.sleep_consistency, 64);
  assert.equal(scored.sleep_duration_variability, 11);
  // The nap day still reads its own nap everywhere else, and its window is nights only.
  const napDay = computeScores(DATASET, SESSIONS, [NAP_DAY]).get(NAP_DAY);
  assert.equal(napDay.sleep_hours, 0.4);
  assert.equal(napDay.sleep_consistency, 95);
});
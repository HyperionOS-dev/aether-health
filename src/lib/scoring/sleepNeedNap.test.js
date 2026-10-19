// Sleep-need nap credit (SCORING_CONFIG.sleep.napNeedCredit / napNeedFloor).
//
// A nap pays down the sleep need that Sleep Performance is measured against. It is never
// added to the night's hours, and Recovery V6 and Biological Age keep reading the
// unadjusted numbers, so a nap can never move either of them.
import test from "node:test";
import assert from "node:assert/strict";
import { computeScores } from "./scores.js";
import { computeBioAge } from "../bioAge.js";
import { buildPayload } from "../gemini.js";
import { SCORING_CONFIG } from "./config.js";

const NAP_NEED_CREDIT = SCORING_CONFIG.sleep.napNeedCredit; // untuned guess
const NAP_NEED_FLOOR = SCORING_CONFIG.sleep.napNeedFloor;

const day = (date, extra = {}) => ({
  date,
  timezone: "UTC",
  hrv: 50,
  hrv_samples_count: 20,
  resting_hr: 60,
  rhr_samples_count: 100,
  sleep_minutes: 450,
  sleep_start: `${date}T00:00`,
  sleep_end: `${date}T06:00`,
  ...extra,
});

const history = (count = 30) => Array.from({ length: count }, (_, index) => {
  const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
  return day(date);
});

const DATE = "2026-01-31";
// No prior-day strain, so the unadjusted need is the 7:30 baseline.
const score = (extra) => {
  const days = [...history(30), day(DATE, extra)];
  return computeScores(days, [], days.map((d) => d.date)).get(DATE);
};

test("the credit is a documented untuned 1:1 guess with a half-need floor", () => {
  assert.equal(NAP_NEED_CREDIT, 1); // untuned guess
  assert.equal(NAP_NEED_FLOOR, 0.5);
});

test("no nap: every scored field matches the output from before the credit existed", () => {
  const plain = score({});
  assert.deepEqual(score({ nap_minutes: 0 }), plain);
  assert.equal(plain.sleep_need, 7.5);
  assert.equal(plain.sleep_need_base, 7.5);
  assert.equal(plain.sleep_performance, plain.sleep_performance_base);
});

test("undefined, null, NaN and negative nap_minutes all count as no nap", () => {
  const plain = score({});
  for (const nap of [undefined, null, NaN, -30]) {
    assert.deepEqual(score({ nap_minutes: nap }), plain, `nap_minutes=${String(nap)}`);
  }
});

test("8:00 night against a 7:30 need with a 30-minute nap: need becomes 7:00", () => {
  const noNap = score({ sleep_minutes: 480 });
  const nap = score({ sleep_minutes: 480, nap_minutes: 30 });
  assert.equal(noNap.sleep_need, 7.5);
  assert.equal(nap.sleep_need, 7); // 7:30 minus the 30-minute nap
  assert.equal(nap.sleep_need_base, 7.5); // unadjusted need kept for undo
  assert.equal(nap.sleep_hours, 8); // the nap is not added to the night
  assert.equal(noNap.sleep_performance, 100); // 8h / 7.5h = 106.7% -> clamped to 100
  assert.equal(nap.sleep_performance, 100); // 8h / 7h = 114.3% -> still clamped to 100
});

test("a short night is where the credit shows: 6h is 80% against 7:30 and 86% against 7:00", () => {
  const noNap = score({ sleep_minutes: 360 });
  const nap = score({ sleep_minutes: 360, nap_minutes: 30 });
  assert.equal(noNap.sleep_performance, 80);
  assert.equal(nap.sleep_performance, 86);
  assert.equal(nap.sleep_hours, 6); // unchanged: naps never add hours
  assert.equal(nap.sleep_need, 7);
  // The whole blast radius of the credit, on a night short enough for it to show.
  const moved = Object.keys(nap).filter((key) => JSON.stringify(nap[key]) !== JSON.stringify(noNap[key]));
  assert.deepEqual(moved.sort(), ["nap_need_credit_dates", "nap_need_credit_minutes", "sleep_need", "sleep_performance"]);
});

test("a nap bigger than the floor allows stops at half of the unadjusted need", () => {
  const capped = score({ sleep_minutes: 360, nap_minutes: 600 }); // a 10-hour "nap"
  assert.equal(capped.sleep_need_base, 7.5);
  assert.equal(capped.sleep_need, 3.8); // r1(7.5 * 0.5)
  assert.equal(capped.sleep_need, Math.round(capped.sleep_need_base * NAP_NEED_FLOOR * 10) / 10);
  assert.equal(capped.sleep_performance, 100);
  assert.equal(score({ sleep_minutes: 360, nap_minutes: 100000 }).sleep_need, 3.8);
});

test("a nap never moves Recovery, the physio penalty or the stored components", () => {
  const noNap = score({ sleep_minutes: 360 });
  const nap = score({ sleep_minutes: 360, nap_minutes: 30 });
  assert.equal(noNap.sleep_performance, 80);
  assert.equal(nap.sleep_performance, 86); // the displayed number did move
  assert.equal(nap.recovery, noNap.recovery);
  assert.equal(nap.physio_penalty, noNap.physio_penalty);
  assert.deepEqual(nap.recovery_components, noNap.recovery_components);
  // The recovery audit trail keeps documenting the unadjusted performance.
  assert.equal(nap.recovery_components.sleep_perf, noNap.sleep_performance_base);
});

test("Biological Age is byte-identical with and without a nap", () => {
  const metrics = (nap) => Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 8, 1 + index)).toISOString().slice(0, 10);
    return {
      date,
      sleep_hours: 6,
      sleep_minutes: 360,
      sleep_consistency: 80,
      resting_hr: 60,
      steps: 8000,
      zone_minutes_residual: [40, 30, 10, 0, 0],
      hr_covered: true,
      ...(index === 119 && nap != null ? { nap_minutes: nap } : {}),
    };
  });
  const withNap = computeBioAge({ metrics: metrics(30), workouts: [], age: 40 });
  const without = computeBioAge({ metrics: metrics(undefined), workouts: [], age: 40 });
  assert.deepEqual(withNap, without);
  assert.equal(withNap.factors.find((factor) => factor.id === "sleep").value, 6);
});

// --- which night the credit lands on ------------------------------------------------
// These nights are filed the way the importers file them: on the day you wake up.

const MON = "2026-10-19"; // a Monday
const TUE = "2026-10-20";
const WED = "2026-10-21";
const previousDay = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const nightRow = (date, extra = {}) => day(date, {
  sleep_minutes: 420,
  sleep_start: `${previousDay(date)}T23:00`,
  sleep_end: `${date}T07:00`,
  ...extra,
});
const creditOn = (date, rows) => {
  const days = [...history(30), ...rows];
  const scored = computeScores(days, [], days.map((d) => d.date)).get(date);
  return {
    need: scored.sleep_need,
    base: scored.sleep_need_base,
    perf: scored.sleep_performance,
    credit: scored.nap_need_credit_minutes,
  };
};

test("a Mon 14:00 nap credits Tuesday's night, not Monday's", () => {
  const rows = [nightRow(MON, { nap_minutes: 30, nap_windows: ["14:00-14:30"] }), nightRow(TUE)];
  // Mon's night is Sun 23:00 -> Mon 07:00 and ended before the nap; Tue's is Mon 23:00 -> Tue 07:00.
  assert.deepEqual(creditOn(MON, rows), { need: 7.5, base: 7.5, perf: 93, credit: 0 });
  assert.deepEqual(creditOn(TUE, rows), { need: 7, base: 7.5, perf: 100, credit: 30 });
});

test("a Mon 19:00 nap, already filed with Tuesday, credits Tuesday's night and never Wednesday's", () => {
  const rows = [nightRow(MON), nightRow(TUE, { nap_minutes: 30, nap_windows: ["19:00-19:30"] }), nightRow(WED)];
  assert.equal(creditOn(MON, rows).credit, 0);
  assert.equal(creditOn(TUE, rows).credit, 30);
  assert.equal(creditOn(WED, rows).credit, 0); // never pushed past the night it precedes
});

test("two naps filed on one day credit the following night once, added together", () => {
  const rows = [nightRow(MON, { nap_minutes: 50, nap_windows: ["14:00-14:30", "15:40-16:00"] }), nightRow(TUE)];
  const mon = creditOn(MON, rows);
  const tue = creditOn(TUE, rows);
  assert.equal(mon.credit, 0);
  assert.equal(tue.credit, 50); // both naps, once, on one night
  assert.equal(tue.need, 6.7); // the need is stored to 0.1 h, so 50 min reads as 0.8 h off
  assert.equal(mon.need, 7.5);
});

test("a nap with no following night imported credits nothing", () => {
  const rows = [nightRow(MON, { nap_minutes: 30, nap_windows: ["14:00-14:30"] })];
  assert.deepEqual(creditOn(MON, rows), { need: 7.5, base: 7.5, perf: 93, credit: 0 });
});

test("a day whose naps straddle the evening cut splits its minutes, losing none", () => {
  const rows = [nightRow(MON, { nap_minutes: 50, nap_windows: ["14:00-14:30", "19:00-19:20"] }), nightRow(TUE)];
  const mon = creditOn(MON, rows);
  const tue = creditOn(TUE, rows);
  assert.equal(mon.credit + tue.credit, 50); // no minute is dropped or counted twice
  assert.equal(mon.credit, 20); // the evening nap stays with the night it precedes
  assert.equal(tue.credit, 30); // the daytime nap moves to the night it precedes
});

// --- dated naps: what both importers write now --------------------------------------
// nap_sessions sits beside nap_windows and carries the nap's own calendar date, so the
// scorer no longer has to guess the night from the hour the nap started at.

const napSession = (date, from, to, minutes) => ({ from: `${date}T${from}`, to: `${date}T${to}`, minutes });

const scoredOn = (date, rows) => {
  const days = [...history(30), ...rows];
  return computeScores(days, [], days.map((d) => d.date)).get(date);
};

test("a dated Mon 19:00 nap credits Tuesday's night, whichever day it was filed on", () => {
  const nap = napSession(MON, "19:00", "19:30", 30);
  // Gadgetbridge files a nap on the day it ended (Monday); Huawei files it together with
  // the night it precedes (Tuesday). Both describe the same nap, and it credits Tuesday.
  const filedOnMon = [nightRow(MON, { nap_minutes: 30, nap_windows: ["19:00-19:30"], nap_sessions: [nap] }), nightRow(TUE), nightRow(WED)];
  const filedOnTue = [nightRow(MON), nightRow(TUE, { nap_minutes: 30, nap_windows: ["19:00-19:30"], nap_sessions: [nap] }), nightRow(WED)];
  for (const rows of [filedOnMon, filedOnTue]) {
    assert.equal(scoredOn(MON, rows).nap_need_credit_minutes, 0);
    assert.equal(scoredOn(TUE, rows).nap_need_credit_minutes, 30);
    assert.equal(scoredOn(WED, rows).nap_need_credit_minutes, 0); // never pushed past the night it precedes
    assert.deepEqual(scoredOn(TUE, rows).nap_need_credit_dates, [MON]); // so the card can say "yesterday"
  }
});

test("the same nap imported through both exporters credits one night once", () => {
  const nap = napSession(MON, "19:00", "19:30", 30);
  const both = [
    nightRow(MON, { nap_minutes: 30, nap_windows: ["19:00-19:30"], nap_sessions: [nap] }), // Gadgetbridge copy
    nightRow(TUE, { nap_minutes: 30, nap_windows: ["19:00-19:30"], nap_sessions: [nap] }), // Huawei copy
    nightRow(WED),
  ];
  assert.equal(scoredOn(MON, both).nap_need_credit_minutes, 0);
  assert.equal(scoredOn(TUE, both).nap_need_credit_minutes, 30); // 30, not 60
  assert.deepEqual(scoredOn(TUE, both).nap_need_credit_dates, [MON]);
});

test("a nap that crosses midnight credits the night that starts after it", () => {
  const rows = [
    nightRow(MON),
    day(TUE, {
      sleep_minutes: 450,
      sleep_start: `${TUE}T00:30`,
      sleep_end: `${TUE}T08:00`,
      nap_minutes: 30,
      nap_windows: ["23:50-00:20"],
      nap_sessions: [{ from: `${MON}T23:50`, to: `${TUE}T00:20`, minutes: 30 }],
    }),
    nightRow(WED),
  ];
  assert.equal(scoredOn(TUE, rows).nap_need_credit_minutes, 30);
  assert.equal(scoredOn(MON, rows).nap_need_credit_minutes, 0);
  assert.equal(scoredOn(WED, rows).nap_need_credit_minutes, 0);
});

test("a dated nap with no following night imported credits nothing", () => {
  const rows = [nightRow(MON, { nap_minutes: 30, nap_windows: ["14:00-14:30"], nap_sessions: [napSession(MON, "14:00", "14:30", 30)] })];
  assert.deepEqual(creditOn(MON, rows), { need: 7.5, base: 7.5, perf: 93, credit: 0 });
  assert.deepEqual(scoredOn(MON, rows).nap_need_credit_dates, []);
});

test("two dated naps on one day add into the following night once", () => {
  const rows = [nightRow(MON, {
    nap_minutes: 50,
    nap_windows: ["14:00-14:30", "15:40-16:00"],
    nap_sessions: [napSession(MON, "14:00", "14:30", 30), napSession(MON, "15:40", "16:00", 20)],
  }), nightRow(TUE)];
  assert.equal(scoredOn(MON, rows).nap_need_credit_minutes, 0);
  assert.equal(scoredOn(TUE, rows).nap_need_credit_minutes, 50);
  assert.deepEqual(scoredOn(TUE, rows).nap_need_credit_dates, [MON]);
});

test("more than six dated naps on one day: the scorer reads the first six", () => {
  const sessions = Array.from({ length: 8 }, (_, index) => {
    const hour = String(10 + index).padStart(2, "0");
    return napSession(MON, `${hour}:00`, `${hour}:05`, 5);
  });
  const rows = [nightRow(MON, { nap_minutes: 40, nap_sessions: sessions }), nightRow(TUE)];
  assert.equal(scoredOn(TUE, rows).nap_need_credit_minutes, 30); // 6 x 5 minutes; the last two are not read
});

test("a dated nap is credited once, never again by the old window heuristic", () => {
  const legacy = [nightRow(MON, { nap_minutes: 30, nap_windows: ["14:00-14:30"] }), nightRow(TUE)];
  const dated = [nightRow(MON, {
    nap_minutes: 30,
    nap_windows: ["14:00-14:30"],
    nap_sessions: [napSession(MON, "14:00", "14:30", 30)],
  }), nightRow(TUE)];
  assert.equal(scoredOn(TUE, legacy).nap_need_credit_minutes, 30);
  assert.equal(scoredOn(TUE, dated).nap_need_credit_minutes, 30); // 30, never 60
  assert.equal(scoredOn(MON, dated).nap_need_credit_minutes, 0);
});

test("a day whose dated naps are unreadable keeps the old window fallback", () => {
  const rows = [nightRow(MON, {
    nap_minutes: 30,
    nap_windows: ["14:00-14:30"],
    nap_sessions: [
      null,
      { from: "nope", to: "nope", minutes: 30 },
      { from: `${MON}T14:30`, to: `${MON}T14:00`, minutes: 30 }, // reversed
      { from: `${MON}T14:00`, to: `${MON}T14:30`, minutes: 0 }, // no minutes
    ],
  }), nightRow(TUE)];
  assert.equal(scoredOn(TUE, rows).nap_need_credit_minutes, 30); // the daytime nap still moves
  assert.deepEqual(scoredOn(TUE, rows).nap_need_credit_dates, [previousDay(TUE)]);
});

test("legacy rows name yesterday as the credited nap day, so the card reads as it did", () => {
  const rows = [nightRow(MON, { nap_minutes: 30, nap_windows: ["14:00-14:30"] }), nightRow(TUE)];
  assert.deepEqual(scoredOn(TUE, rows).nap_need_credit_dates, [MON]);
  assert.deepEqual(scoredOn(MON, rows).nap_need_credit_dates, []);
  // An evening nap the importers filed together with its own night is yesterday's as well.
  const evening = [nightRow(TUE, { nap_minutes: 30, nap_windows: ["19:00-19:30"] }), nightRow(WED)];
  assert.deepEqual(scoredOn(TUE, evening).nap_need_credit_dates, [MON]);
  // A day that straddles the cut names one day per half, each the day before its own night.
  const straddle = [nightRow(MON, { nap_minutes: 50, nap_windows: ["14:00-14:30", "19:00-19:20"] }), nightRow(TUE)];
  assert.deepEqual(scoredOn(MON, straddle).nap_need_credit_dates, [previousDay(MON)]);
  assert.deepEqual(scoredOn(TUE, straddle).nap_need_credit_dates, [MON]);
});

test("a dated nap moves the same four fields and leaves Recovery untouched", () => {
  const plain = [nightRow(MON), nightRow(TUE, { sleep_minutes: 360 })];
  const dated = [nightRow(MON, {
    nap_minutes: 30,
    nap_windows: ["19:00-19:30"],
    nap_sessions: [napSession(MON, "19:00", "19:30", 30)],
  }), nightRow(TUE, { sleep_minutes: 360 })];
  const withNap = scoredOn(TUE, dated);
  const without = scoredOn(TUE, plain);
  assert.equal(withNap.sleep_hours, without.sleep_hours); // unchanged: naps never add hours
  assert.equal(without.sleep_performance, 80); // 6h against 7:30
  assert.equal(withNap.sleep_performance, 86); // 6h against 7:00
  assert.equal(withNap.recovery, without.recovery);
  assert.equal(withNap.physio_penalty, without.physio_penalty);
  assert.deepEqual(withNap.recovery_components, without.recovery_components);
  assert.equal(withNap.recovery_components.sleep_perf, without.sleep_performance_base);
  const moved = Object.keys(withNap).filter((key) => JSON.stringify(withNap[key]) !== JSON.stringify(without[key]));
  assert.deepEqual(moved.sort(), ["nap_need_credit_dates", "nap_need_credit_minutes", "sleep_need", "sleep_performance"]);
});

test("Biological Age is byte-identical with dated naps too", () => {
  const metrics = (extra) => Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 8, 1 + index)).toISOString().slice(0, 10);
    return {
      date,
      sleep_hours: 6,
      sleep_minutes: 360,
      sleep_consistency: 80,
      resting_hr: 60,
      steps: 8000,
      zone_minutes_residual: [40, 30, 10, 0, 0],
      hr_covered: true,
      sleep_start: `${previousDay(date)}T23:00`,
      sleep_end: `${date}T05:00`,
      ...(index === 119 ? extra : {}),
    };
  });
  const dated = computeBioAge({
    metrics: metrics({
      nap_minutes: 30,
      nap_windows: ["19:00-19:30"],
      nap_sessions: [{ from: "2025-12-28T19:00", to: "2025-12-28T19:30", minutes: 30 }],
    }),
    workouts: [],
    age: 40,
  });
  const without = computeBioAge({ metrics: metrics({}), workouts: [], age: 40 });
  assert.deepEqual(dated, without);
});

test("nap fields, windows and dates stay out of the Gemini payload", () => {
  const metrics = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 8, 1 + index)).toISOString().slice(0, 10);
    return {
      date,
      sleep_hours: 7,
      sleep_minutes: 420,
      sleep_consistency: 80,
      resting_hr: 60,
      steps: 8000,
      zone_minutes_residual: [40, 30, 10, 0, 0],
      hr_covered: true,
      sleep_start: `${previousDay(date)}T23:00`,
      sleep_end: `${date}T05:00`,
      ...(index === 119 ? {
        nap_minutes: 30,
        nap_windows: ["19:00-19:30"],
        nap_sessions: [{ from: "2025-12-28T19:00", to: "2025-12-28T19:30", minutes: 30 }],
      } : {}),
    };
  });
  const payload = buildPayload(computeBioAge({ metrics, workouts: [], age: 40 }));
  const json = JSON.stringify(payload);
  assert.deepEqual(Object.keys(payload).sort(), ["age", "confidence", "configVersion", "factors", "totalYears", "windowDays"]);
  assert.doesNotMatch(json, /nap/i);
  assert.doesNotMatch(json, /\d{4}-\d{2}-\d{2}/); // no days either
});

// The payload is an explicit allowlist: buildPayload() copies five scalars and, per factor,
// an explicit set of aggregate keys. Nothing spreads a day row or the result object into it,
// so a DailyMetric field can only reach Gemini as one of those aggregates. This test hands it
// a day carrying every nap, sleep-window and timestamp field and proves none of them — name
// or value — appears anywhere in the serialized payload.
test("no nap, sleep-window or timestamp field reaches the serialized payload", () => {
  // Distinctive values: none of them can be produced by rounding an aggregate.
  const LOUD = {
    date: "2024-03-08",
    timezone: "Asia/Riyadh",
    sleep_start: "2024-03-07T23:11",
    sleep_end: "2024-03-08T05:47",
    hrv: 51,
    hrv_samples_count: 22,
    rhr_samples_count: 134,
    nap_minutes: 30,
    nap_windows: ["19:11-19:41"],
    nap_sessions: [{ from: "2024-03-08T19:11", to: "2024-03-08T19:41", minutes: 30 }],
    nap_need_credit_minutes: 30,
    nap_need_credit_dates: ["2024-03-07"],
    sources: { sleep: "stage_rows", resting_hr: "device_resting_hr" },
    algo_version: "aether-scores-v6",
  };
  const metrics = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 8, 1 + index)).toISOString().slice(0, 10);
    const base = {
      date,
      sleep_hours: 7,
      sleep_minutes: 420,
      sleep_consistency: 80,
      resting_hr: 60,
      steps: 8000,
      zone_minutes_residual: [40, 30, 10, 0, 0],
      hr_covered: true,
      sleep_start: `${previousDay(date)}T23:00`,
      sleep_end: `${date}T05:00`,
    };
    return index === 119 ? { ...base, ...LOUD } : base;
  });

  const payload = buildPayload(computeBioAge({ metrics, workouts: [], age: 40 }));
  const json = JSON.stringify(payload);

  // Field names first: no key of a day row survives into the request body. Plain-English
  // labels and units come from the static factor config ("Daily steps", "steps/day"), so the
  // raw field name is what this looks for — an underscore, as the record stores it.
  const dayRowKeys = [
    ...Object.keys(LOUD),
    "sleep_start", "sleep_end", "date", "hrv", "resting_hr", "nap_minutes",
    "created_by_id", "updated_date",
  ];
  for (const field of dayRowKeys) {
    assert.doesNotMatch(json, new RegExp(field), `${field} must not appear in the payload`);
  }
  // Then the values: not even the text of a nap window or a bed time.
  for (const value of ["2024-03-08", "2024-03-07", "23:11", "05:47", "19:11-19:41", "Asia/Riyadh", "aether-scores-v6", "stage_rows"]) {
    assert.equal(json.includes(value), false, `${value} must not appear in the payload`);
  }
  // Last-30-day and 7-day aggregates are the only per-window numbers, and there are no
  // nested rows: every leaf is a number, a string from the factor config, or null.
  assert.deepEqual(
    [...new Set(payload.factors.flatMap((factor) => Object.keys(factor)))].sort(),
    ["label", "last30", "last7", "last7Direction", "rank", "target", "unit", "value", "years"],
  );
  const leaves = (value) => (value && typeof value === "object" ? Object.values(value).flatMap(leaves) : [value]);
  assert.ok(leaves(payload).every((leaf) => leaf === null || typeof leaf === "number" || typeof leaf === "string"));
});

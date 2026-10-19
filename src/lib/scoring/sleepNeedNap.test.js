// Sleep-need nap credit (SCORING_CONFIG.sleep.napNeedCredit / napNeedFloor).
//
// A nap pays down the sleep need that Sleep Performance is measured against. It is never
// added to the night's hours, and Recovery V6 and Biological Age keep reading the
// unadjusted numbers, so a nap can never move either of them.
import test from "node:test";
import assert from "node:assert/strict";
import { computeScores } from "./scores.js";
import { computeBioAge } from "../bioAge.js";
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
  assert.deepEqual(moved.sort(), ["nap_need_credit_minutes", "sleep_need", "sleep_performance"]);
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

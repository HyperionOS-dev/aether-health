import test from "node:test";
import assert from "node:assert/strict";
import {
  ALGO_VERSION,
  baselineV5AsOf,
  computeScores,
  recoveryAtTime,
} from "./scores.js";

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

const workout = ({ date, endedAt, recoveryMinutes, load = 28 }) => ({
  date,
  activity: "Badminton",
  ended_at: endedAt,
  recovery_time_min: recoveryMinutes,
  workout_load: load,
  strain: 10,
});

test("V6 retains V5 shared-SD shrinkage and the RHR floor", () => {
  const days = history(10);
  const base = baselineV5AsOf([...days, day("2026-01-11")], "2026-01-11");
  assert.equal(ALGO_VERSION, "aether-scores-v6");
  assert.equal(base.hrvN, 10);
  assert.equal(base.hrvSd, 5);
  assert.equal(base.rhrN, 10);
  assert.equal(base.rhrSd, 2.5);
});

test("flat HRV and a 3 bpm RHR change move Recovery by fewer than 15 points", () => {
  const prior = history(30);
  const date = "2026-01-31";
  const baseline = computeScores([...prior, day(date)], [], [date]).get(date);
  const elevated = computeScores([...prior, day(date, { resting_hr: 63 })], [], [date]).get(date);
  assert.ok(Math.abs(baseline.recovery - elevated.recovery) < 15);
  assert.ok(elevated.physio_penalty > baseline.physio_penalty);
});

test("Oct 8 device recovery minutes produce about 69% immediately and full at 20:24 local", () => {
  const session = workout({
    date: "2026-10-08",
    endedAt: "2026-10-08T08:24:01.000Z",
    recoveryMinutes: 540,
  });
  const justEnded = recoveryAtTime([session], 0, new Date("2026-10-08T08:24:01.000Z"), 1);
  assert.equal(justEnded.recovery, 69);
  assert.equal(justEnded.time_to_full_hours, 9);
  const recovered = recoveryAtTime([session], 0, new Date("2026-10-08T17:24:01.000Z"), 1);
  assert.equal(recovered.recovery, 100);
  assert.equal(recovered.recovery_status, "Fully recovered");
});

test("Oct 3 660-minute recovery time yields about 61% immediately after the session", () => {
  const session = workout({
    date: "2026-10-03",
    endedAt: "2026-10-03T16:31:21.000Z",
    recoveryMinutes: 660,
  });
  const result = recoveryAtTime([session], 0, new Date("2026-10-03T16:31:21.000Z"), 1);
  assert.ok(result.recovery >= 61 && result.recovery <= 62);
});

test("missing today's sleep is provisional and V6 component data is stored", () => {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const result = computeScores([day(date, { sleep_end: undefined })], [], [date]).get(date);
  assert.equal(result.algo_version, "aether-scores-v6");
  assert.equal(result.recovery_provisional, true);
  assert.equal(result.recovery_status, "Fully recovered");
  assert.equal(typeof result.recovery_components.zc, "number");
  assert.equal(typeof result.recovery_components.hrv_z, "number");
  assert.equal(typeof result.recovery_components.rhr_z, "number");
  assert.equal(result.recovery_components.snapshot_at, `${date}T08:00:00.000Z`);
});

test("V6 score is stored at 08:00 and contains debt and body-signal audit", () => {
  const date = "2026-10-10";
  const days = [day(date, { hrv: 60, recovery_rating: 4 })];
  const session = workout({ date: "2026-10-08", endedAt: "2026-10-08T08:24:01.000Z", recoveryMinutes: 540 });
  const scored = computeScores(days, [session], [date]).get(date);
  assert.equal(scored.algo_version, "aether-scores-v6");
  assert.equal(scored.recovery, 100);
  assert.equal(scored.workout_debt, 0);
  assert.equal(scored.physio_penalty, 0);
  assert.equal(scored.recovery_rating, 4);
  assert.equal(scored.recovery_components.snapshot_at, `${date}T08:00:00.000Z`);
});

test("watch recovery minutes win; workload supplies the configured fallback", () => {
  const now = new Date("2026-10-08T08:24:01.000Z");
  const supplied = workout({ date: "2026-10-08", endedAt: now.toISOString(), recoveryMinutes: 540 });
  const fallback = { ...supplied, recovery_time_min: null };
  const suppliedDebt = recoveryAtTime([supplied], 0, now, 1).workout_debt;
  const fallbackDebt = recoveryAtTime([fallback], 0, now, 1).workout_debt;
  assert.equal(suppliedDebt, 31.5);
  assert.ok(fallbackDebt > 0);
  assert.notEqual(fallbackDebt, suppliedDebt);
});
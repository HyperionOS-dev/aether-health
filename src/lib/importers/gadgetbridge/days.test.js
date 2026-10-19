// The day's resting heart rate, and which of its two sources wins.
//
// A Huawei watch reports its own resting rate for the day, and an export carries it in the
// activity table's RESTING_HEART_RATE column. The overnight band is the fallback for the days
// that column says nothing about, and it is deliberately second: a p05 sits at the deepest
// sleep nadir rather than at a resting average, so it reads a few beats under the number the
// watch shows on its own screen, and every zone edge downstream is built from resting HR.
// These tests pin the order down, both ways round.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildDays } from "./days.ts";

const START = Date.parse("2026-03-08T00:00:00Z") / 1000;
const MINUTE = 60;
const TZ = "Etc/UTC";

// Activity samples every two minutes through the night: 180 readings the band can be taken
// from, cycling 50..54. The device's own resting value is written per row, and -1 is the
// dump's way of saying "not reported" — the value the band exists to stand in for.
function activityRows(deviceRhrAt = () => -1) {
  const rows = [];
  for (let m = 0; m <= 358; m += 2) rows.push([START + m * MINUTE, 50 + (m % 5), deviceRhrAt(m)]);
  return rows;
}

// One stage row per minute from 00:00 to 05:59, all light sleep, so the night that ends on
// this date is the sleep window the band is measured over.
function stageRows() {
  const rows = [];
  for (let m = 0; m < 360; m++) rows.push([START + m * MINUTE, 1]);
  return rows;
}

const csv = (header, rows) => [header, ...rows.map((row) => row.join(","))].join("\n") + "\n";

const tables = (deviceRhrAt) => ({
  HUAWEI_ACTIVITY_SAMPLE: csv("TIMESTAMP,HEART_RATE,RESTING_HEART_RATE", activityRows(deviceRhrAt)),
  HUAWEI_SLEEP_STAGE_SAMPLE: csv("TIMESTAMP,STAGE", stageRows()),
});

const buildDay = (deviceRhrAt) => {
  const days = buildDays(tables(deviceRhrAt), TZ, 0);
  assert.equal(days.length, 1, "the fixture describes one day");
  return days[0];
};

describe("buildDays resting heart rate", () => {
  test("the watch's own resting value wins over the overnight band", () => {
    const day = buildDay(() => 58);
    assert.equal(day.resting_hr, 58);
    assert.equal(day.sources.resting_hr, "device_resting_hr");
  });

  test("the band is still measured and reported, so the two can be compared later", () => {
    const day = buildDay(() => 58);
    // The night's readings, all of them inside the sleep window, either way.
    assert.equal(day.rhr_samples_count, 180);
    assert.equal(day.hrv_samples_count, 0);
  });

  test("several device readings become their median, not their mean", () => {
    // Two 58s and one 64 out of the day's readings: the median is 58, the mean would be 60.
    const day = buildDay((m) => (m === 100 || m === 200 ? 58 : m === 300 ? 64 : -1));
    assert.equal(day.resting_hr, 58);
    assert.equal(day.sources.resting_hr, "device_resting_hr");
  });

  test("a day the watch reported no resting value for falls back to the band", () => {
    const day = buildDay();
    assert.equal(day.resting_hr, 50);
    assert.equal(day.sources.resting_hr, "overnight_hr_p05");
  });
});

// --- nap sessions -------------------------------------------------------------------
// A nap is stored twice: nap_windows for the display, and nap_sessions — the same session
// carrying its own calendar date — for the scorer, which no longer has to guess which night
// a nap shortens from the hour it started at.

const DAY = "2026-03-08"; // a Sunday
const at = (date, hour, minute = 0) =>
  Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`) / 1000;

// One stage row per minute, all light sleep (stage 1).
const minutesFrom = (from, count) => Array.from({ length: count }, (_, index) => [from + index * MINUTE, 1]);

// Sat 23:00 -> Sun 07:00 (the night that ends on Sunday), a 30-minute Sunday 19:00 nap, then
// Sun 23:00 -> Mon 07:00 (the night that ends on Monday).
const napRows = () => [
  ...minutesFrom(at("2026-03-07", 23), 480),
  ...minutesFrom(at(DAY, 19), 30),
  ...minutesFrom(at(DAY, 23), 480),
];

const napDays = () => new Map(
  buildDays({ HUAWEI_SLEEP_STAGE_SAMPLE: csv("TIMESTAMP,STAGE", napRows()) }, TZ, 0)
    .map((day) => [day.date, day]),
);

describe("buildDays nap sessions", () => {
  test("the nap gets its own dated session beside its window", () => {
    const sunday = napDays().get(DAY);
    assert.equal(sunday.nap_minutes, 30);
    assert.deepEqual(sunday.nap_windows, ["19:00-19:29"]);
    // The window ends one minute past the last staged row, so its length is the nap's own
    // staged minutes and the other exporter describes the same nap with the same pair.
    assert.deepEqual(sunday.nap_sessions, [{ from: "2026-03-08T19:00", to: "2026-03-08T19:30", minutes: 30 }]);
  });

  test("the night is untouched by the dated nap", () => {
    const sunday = napDays().get(DAY);
    assert.equal(sunday.sleep_start, "2026-03-07T23:00");
    assert.equal(sunday.sleep_end, "2026-03-08T06:59");
    assert.equal(sunday.light_minutes, 480); // the nap is not part of the night
  });

  test("a day with no nap writes no nap fields at all", () => {
    const monday = napDays().get("2026-03-09");
    assert.equal("nap_minutes" in monday, false);
    assert.equal("nap_sessions" in monday, false);
  });
});
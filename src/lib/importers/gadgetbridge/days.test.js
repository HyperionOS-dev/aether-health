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
// The nap fields the Huawei importers write.
//
// Every nap is stored twice: nap_windows for the display, and nap_sessions — the same
// session carrying its own calendar date — for the scorer. Huawei files an evening sleep
// session under the following day, so a Mon 19:00 nap sits on Tuesday's row; the dated copy
// is what lets the scorer credit Tuesday's night instead of guessing from the hour.
//
// Both Huawei paths are covered: the health-detail JSON records, and the metric CSV.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { finalizeDay, finalizeHealthDetailDay, parseHealthDetailRecords, parseMetricsCsv } from "./parse.ts";

const point = (key, start, end) => ({ key, startTime: Date.parse(start), endTime: Date.parse(end) });

// Mon 19:00 -> 19:30 was a nap; the nights either side of it are the two 8-hour sleeps.
const detailRecords = () => [{
  timeZone: "+00:00",
  samplePoints: [
    point("PROFESSIONAL_SLEEP_SHALLOW", "2026-10-18T23:00:00Z", "2026-10-19T03:00:00Z"),
    point("PROFESSIONAL_SLEEP_DEEP", "2026-10-19T03:00:00Z", "2026-10-19T07:00:00Z"),
    point("PROFESSIONAL_SLEEP_NOON", "2026-10-19T19:00:00Z", "2026-10-19T19:30:00Z"),
    point("PROFESSIONAL_SLEEP_SHALLOW", "2026-10-19T23:00:00Z", "2026-10-20T03:00:00Z"),
    point("PROFESSIONAL_SLEEP_DEEP", "2026-10-20T03:00:00Z", "2026-10-20T07:00:00Z"),
  ],
}];

const detailDays = () => new Map(
  parseHealthDetailRecords(detailRecords()).days.map((day) => [day.date, finalizeHealthDetailDay(day)]),
);

const CSV = [
  "date,sleep_stage,duration_in_seconds",
  "2026.10.18 23:00:00,light,14400", // the night that ends on the 19th
  "2026.10.19 03:00:00,deep,14400",
  "2026.10.19 19:00:00,light,1800", // the nap
  "2026.10.19 23:00:00,light,14400", // the night that ends on the 20th
  "2026.10.20 03:00:00,deep,14400",
  "",
].join("\n");

describe("huawei nap sessions", () => {
  test("an evening nap is dated on the day it was taken, filed with the night it precedes", () => {
    const tuesday = detailDays().get("2026-10-20");
    assert.equal(tuesday.sleep_start, "2026-10-19T23:00");
    assert.equal(tuesday.sleep_end, "2026-10-20T07:00");
    assert.equal(tuesday.nap_minutes, 30);
    assert.deepEqual(tuesday.nap_windows, ["19:00-19:30"]);
    assert.deepEqual(tuesday.nap_sessions, [{ from: "2026-10-19T19:00", to: "2026-10-19T19:30", minutes: 30 }]);
  });

  test("the night before the nap has no nap fields", () => {
    const monday = detailDays().get("2026-10-19");
    assert.equal(monday.sleep_end, "2026-10-19T07:00");
    assert.equal("nap_minutes" in monday, false);
    assert.equal("nap_sessions" in monday, false);
  });

  test("finalizeDay stores the dated session with the window", () => {
    const stored = finalizeDay(detailDays().get("2026-10-20"));
    assert.deepEqual(stored.nap_sessions, [{ from: "2026-10-19T19:00", to: "2026-10-19T19:30", minutes: 30 }]);
    assert.deepEqual(stored.nap_windows, ["19:00-19:30"]);
    assert.equal(stored.nap_minutes, 30);
    assert.equal(stored.sleep_start, "2026-10-19T23:00");
    assert.equal(stored.sleep_minutes, 480); // the nap is not part of the night
  });

  test("the metric CSV path dates the same nap the same way", () => {
    const parsed = parseMetricsCsv(CSV);
    const raw = parsed.days.find((day) => day.date === "2026-10-20");
    assert.deepEqual(raw.nap_sessions, [{ from: "2026-10-19T19:00", to: "2026-10-19T19:30", minutes: 30 }]);
    const stored = finalizeDay(raw);
    assert.deepEqual(stored.nap_sessions, raw.nap_sessions);
    assert.deepEqual(stored.nap_windows, ["19:00-19:30"]);
    assert.equal(stored.sleep_start, "2026-10-19T23:00");
    assert.equal(stored.sleep_end, "2026-10-20T07:00");
  });

  test("no nap leaves the field off the record entirely", () => {
    const parsed = parseMetricsCsv("date,sleep_stage,duration_in_seconds\n2026.10.19 23:00:00,light,14400\n");
    assert.equal("nap_sessions" in parsed.days[0], false);
  });
});
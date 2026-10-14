// Gadgetbridge's FIT activity files. The bytes are built here rather than checked in, the same way
// fixture.mjs builds its tables, so the repository carries no binaries. Each test states the
// session or record it encodes, so a field-number mistake shows up as a readable failure.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildFitWorkouts, decodeFit, findFitDuplicates, fitActivityLabel, isFit } from "./fit.ts";

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
const fitSeconds = (iso) => (Date.parse(iso) - FIT_EPOCH_MS) / 1000;
const semicircles = (deg) => Math.round((deg * 2 ** 31) / 180);

// [size, base type byte] pairs as the FIT profile names them.
const UINT8 = [1, 0x02];
const ENUM = [1, 0x00];
const UINT16 = [2, 0x84];
const UINT32 = [4, 0x86];
const SINT32 = [4, 0x85];

function encode([size, base], v) {
  const b = Buffer.alloc(size);
  if (size === 1) b.writeUInt8(v);
  else if (size === 2) b.writeUInt16LE(v);
  else if (base === SINT32[1]) b.writeInt32LE(v);
  else b.writeUInt32LE(v);
  return [...b];
}

// A definition message: the header byte, reserved, architecture (0 = little endian), the global
// message number, then the field count and three bytes per field.
function definition(local, global, fields) {
  const bytes = [0x40 | local, 0, 0, global & 0xff, global >> 8, fields.length];
  for (const [num, type] of fields) bytes.push(num, type[0], type[1]);
  return bytes;
}

// A data message: the local message number, then each value in the order the definition lists them.
function data(local, fields, values) {
  const bytes = [local];
  fields.forEach(([, type], i) => bytes.push(...encode(type, values[i])));
  return bytes;
}

function fitFile(messages) {
  const body = messages.flat();
  const header = [14, 16, 0x08, 0x08, body.length & 0xff, (body.length >> 8) & 0xff, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0];
  return new Uint8Array([...header, ...body]);
}

const SESSION_FIELDS = [
  [2, UINT32], // start_time
  [5, ENUM], // sport
  [6, ENUM], // sub_sport
  [7, UINT32], // total_elapsed_time, scale 1000
  [8, UINT32], // total_timer_time, scale 1000
  [9, UINT32], // total_distance, scale 100
  [10, UINT32], // total_strides
  [11, UINT16], // total_calories
  [16, UINT8], // avg_heart_rate
  [17, UINT8], // max_heart_rate
];

const RECORD_FIELDS = [
  [0, SINT32], // position_lat, semicircles
  [1, SINT32], // position_long, semicircles
  [3, UINT8], // heart_rate
  [253, UINT32], // timestamp
];

// A 16-minute walk starting 2026-10-11 10:22:49 UTC, with a GPS point and heart rate each minute.
const START = "2026-10-11T10:22:49Z";

function walkFile(overrides = {}) {
  const start = fitSeconds(START);
  const session = {
    start,
    sport: 11,
    subSport: 0,
    elapsed: 956000,
    timer: 956000,
    distance: 62000,
    strides: 1054,
    calories: 72,
    avgHr: 110,
    maxHr: 143,
    ...overrides,
  };
  const sessionMsg = [
    definition(0, 18, SESSION_FIELDS),
    data(0, SESSION_FIELDS, [session.start, session.sport, session.subSport, session.elapsed, session.timer, session.distance, session.strides, session.calories, session.avgHr, session.maxHr]),
  ];
  const records = [definition(1, 20, RECORD_FIELDS)];
  [[24.7, 46.6, 100], [24.7005, 46.6005, 120], [24.701, 46.601, 130]].forEach(([lat, lon, hr], i) => {
    records.push(data(1, RECORD_FIELDS, [semicircles(lat), semicircles(lon), hr, start + i * 60]));
  });
  return fitFile([...sessionMsg, ...records]);
}

describe("isFit", () => {
  test("recognises the .FIT signature at bytes 8 to 11", () => {
    assert.equal(isFit(walkFile()), true);
  });

  test("rejects a zip, a database and a short file", () => {
    assert.equal(isFit(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0])), false);
    assert.equal(isFit(new TextEncoder().encode("SQLite format 3\0")), false);
    assert.equal(isFit(new Uint8Array([14, 16])), false);
  });
});

describe("decodeFit", () => {
  test("reads the session summary: start, times, distance, steps, calories, heart rate and sport", () => {
    const { sessions } = decodeFit(walkFile());
    assert.equal(sessions.length, 1);
    const s = sessions[0];
    assert.equal(s.start, Date.parse(START));
    assert.equal(s.elapsedS, 956);
    assert.equal(s.timerS, 956);
    assert.equal(s.distanceM, 620);
    assert.equal(s.steps, 1054);
    assert.equal(s.calories, 72);
    assert.equal(s.avgHr, 110);
    assert.equal(s.maxHr, 143);
    assert.equal(s.sport, 11);
  });

  test("reads each record's GPS position in degrees and its heart rate", () => {
    const { points } = decodeFit(walkFile());
    assert.equal(points.length, 3);
    assert.equal(points[0].ms, Date.parse(START));
    assert.ok(Math.abs(points[0].lat - 24.7) < 1e-6);
    assert.ok(Math.abs(points[0].lon - 46.6) < 1e-6);
    assert.equal(points[0].hr, 100);
    assert.equal(points[2].hr, 130);
  });

  test("a value the device could not measure reads as absent, not as zero or the maximum", () => {
    const { sessions, points } = decodeFit(walkFile({ avgHr: 0xff, maxHr: 0xff, calories: 0xffff }));
    assert.equal(sessions[0].avgHr, null);
    assert.equal(sessions[0].maxHr, null);
    assert.equal(sessions[0].calories, null);
    assert.ok(points.every((p) => p.hr !== null));
  });

  test("a compressed timestamp header carries the clock forward from the last explicit timestamp", () => {
    const start = fitSeconds(START);
    const timed = [definition(0, 20, RECORD_FIELDS), data(0, RECORD_FIELDS, [semicircles(24.7), semicircles(46.6), 100, start])];
    // Local message 1 has no timestamp field: its clock comes from the 5-bit offset in the header.
    const untimed = [definition(1, 20, RECORD_FIELDS.slice(0, 3))];
    const offset = 12;
    const compressedHeader = [0x80 | (1 << 5) | offset];
    const compressed = [...compressedHeader, ...encode(SINT32, semicircles(24.7005)), ...encode(SINT32, semicircles(46.6005)), 120];
    const { points } = decodeFit(fitFile([...timed, ...untimed, compressed]));
    const low = start % 32;
    const expected = start - low + (offset < low ? 32 : 0) + offset;
    assert.equal(points.length, 2);
    assert.equal(points[1].ms, FIT_EPOCH_MS + expected * 1000);
    assert.equal(points[1].hr, 120);
  });

  test("throws for a file that is not FIT", () => {
    assert.throws(() => decodeFit(new Uint8Array(20)), /not a FIT activity file/);
  });
});

describe("fitActivityLabel", () => {
  test("names walking, and tells outdoor from indoor running by GPS", () => {
    assert.equal(fitActivityLabel(11, true), "Walking");
    assert.equal(fitActivityLabel(11, false), "Walking");
    assert.equal(fitActivityLabel(1, true), "Outdoor running");
    assert.equal(fitActivityLabel(1, false), "Indoor running");
  });

  test("an unknown sport resolves to the generic label instead of a number", () => {
    assert.equal(fitActivityLabel(255, true), "Workout");
    assert.equal(fitActivityLabel(null, false), "Workout");
  });
});

describe("findFitDuplicates", () => {
  const dbWalk = { date: "2026-10-11", activity: "Walking", start_time: "10:23", end_time: "10:39" };
  const fitWalk = { date: "2026-10-11", activity: "Walking", start_time: "10:23", end_time: "10:39" };

  test("a FIT session within 2 minutes of a database workout on start and end is skipped, and the database copy is the one kept", () => {
    const { kept, skipped } = findFitDuplicates([dbWalk], [{ ...fitWalk, start_time: "10:25", end_time: "10:37" }]);
    assert.equal(kept.length, 0);
    assert.deepEqual(skipped, [{ activity: "Walking", date: "2026-10-11", start_time: "10:25" }]);
  });

  test("exactly 2 minutes apart on both ends still counts as the same session", () => {
    assert.equal(findFitDuplicates([dbWalk], [{ ...fitWalk, start_time: "10:21", end_time: "10:41" }]).skipped.length, 1);
  });

  test("3 minutes off on the start keeps the FIT session", () => {
    const { kept, skipped } = findFitDuplicates([dbWalk], [{ ...fitWalk, start_time: "10:20" }]);
    assert.equal(skipped.length, 0);
    assert.equal(kept.length, 1);
  });

  test("3 minutes off on the end keeps the FIT session", () => {
    assert.equal(findFitDuplicates([dbWalk], [{ ...fitWalk, end_time: "10:42" }]).kept.length, 1);
  });

  test("a different sport family is never a duplicate, even at the same times", () => {
    const { kept, skipped } = findFitDuplicates([{ ...dbWalk, activity: "Badminton" }], [fitWalk]);
    assert.equal(skipped.length, 0);
    assert.equal(kept.length, 1);
  });

  test("indoor and outdoor running are one family and count as duplicates", () => {
    const { skipped } = findFitDuplicates([{ ...dbWalk, activity: "Indoor running" }], [{ ...fitWalk, activity: "Outdoor running" }]);
    assert.equal(skipped.length, 1);
  });

  test("a different date is not a duplicate", () => {
    assert.equal(findFitDuplicates([dbWalk], [{ ...fitWalk, date: "2026-10-12" }]).kept.length, 1);
  });

  test("a database workout with no end time cannot be matched, so the FIT session is kept", () => {
    assert.equal(findFitDuplicates([{ ...dbWalk, end_time: null }], [fitWalk]).kept.length, 1);
  });
});

describe("buildFitWorkouts", () => {
  test("builds one walking workout with the session's own figures and the importer's shape", () => {
    const { records, crossCheck } = buildFitWorkouts(walkFile(), "UTC", 0, {});
    assert.equal(crossCheck, null);
    assert.equal(records.length, 1);
    const w = records[0];
    assert.equal(w.date, "2026-10-11");
    assert.equal(w.activity, "Walking");
    // Clock times round to the nearest minute, as every other importer workout does: 10:22:49 reads 10:23.
    assert.equal(w.start_time, "10:23");
    assert.equal(w.end_time, "10:39");
    assert.equal(w.duration_min, 16);
    assert.equal(w.distance_km, 0.62);
    assert.equal(w.steps, 1054);
    assert.equal(w.calories, 72);
    assert.equal(w.avg_hr, 110);
    assert.equal(w.max_hr, 143);
    assert.equal(w.is_outdoor, true);
    assert.equal(w.source, "gadgetbridge_import");
    assert.equal(w.method, "pace");
    assert.ok(w.strain > 0);
  });

  test("fields a FIT file does not carry stay null rather than guessed", () => {
    const [w] = buildFitWorkouts(walkFile(), "UTC", 0, {}).records;
    assert.equal(w.workout_load, null);
    assert.equal(w.aerobic_effect, null);
    assert.equal(w.anaerobic_effect, null);
    assert.equal(w.ground_contact_ms, null);
    assert.equal(w.vertical_oscillation_cm, null);
    assert.equal(w.ground_time_balance_pct, null);
    assert.equal(w.recovery_time_min, null);
    assert.equal(w.min_hr, null);
  });

  test("a session under a minute is dropped rather than filed as a zero-length workout", () => {
    assert.equal(buildFitWorkouts(walkFile({ elapsed: 20000, timer: 20000 }), "UTC", 0, {}).records.length, 0);
  });
});


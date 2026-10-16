// Reading a Gadgetbridge export, whichever shape it arrives in.
//
// The point of these tests is convergence: a zip of table files and the database file itself have
// to produce the same days and the same workouts, because everything downstream reads one shape of
// table. The fixture is built twice from one description — as the CSVs a table-file export holds,
// and as the sqlite file a database export holds — read through the real readers, and compared.
//
// The importer is browser code, so the two things a bundler normally supplies are supplied here:
// the "@/..." alias and extensionless "./tables" specifiers come from node-alias-hooks.mjs, which
// the test script loads with --import, and the sql.js WebAssembly binary is loaded from node_modules
// through the same injected loader the app passes in.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { buildDays } from "./days.ts";
import { buildWorkouts, sessionSpans } from "./workouts.ts";
import { MAX_ZIP_EXPANDED_BYTES, parseCsv } from "./tables.ts";
import {
  csvCell,
  dbToTables,
  detectGadgetbridgeSource,
  isSqlite,
  isZip,
  loadSql,
  readTables,
  tableToCsv,
} from "./sqlite.ts";
import { EXPORT, csvFiles, csvText, databaseBytes, zipBytes } from "./fixture.mjs";

// The app hands vite's asset URL to sql.js; node needs a path to the same file, which sits next to
// sql.js's own entry point.
const wasmUrl = fileURLToPath(new URL("sql-wasm.wasm", import.meta.resolve("sql.js")));
const load = (config) => initSqlJs({ locateFile: (file) => config.locateFile(file) });
const read = (bytes, options) => readTables(bytes, { load, wasmUrl, ...options });

const TZ = "Etc/UTC";
const NESTED = "gadgetbridge_export";

// --- the shape a file is, read from its own bytes -----------------------------------------

describe("detectGadgetbridgeSource", () => {
  test("a database is recognised from sqlite's header, whatever the file was named", () => {
    assert.equal(isSqlite(new TextEncoder().encode("SQLite format 3\0rest")), true);
    assert.equal(detectGadgetbridgeSource(databaseBytes()), "database");
  });

  test("a zip is recognised from its magic, and a loose table file is neither shape", () => {
    assert.equal(isZip(zipBytes([["A.csv", new TextEncoder().encode("A\n1\n")]])), true);
    assert.equal(detectGadgetbridgeSource(zipBytes([])), "zip");
    assert.equal(detectGadgetbridgeSource(new TextEncoder().encode("TIMESTAMP,STAGE\n1,1\n")), null);
    assert.equal(detectGadgetbridgeSource(new Uint8Array([0x50])), null);
  });
});

// --- the database, brought to the shape the readers already use ----------------------------

describe("dbToTables", () => {
  test("every table with rows becomes CSV, keyed in upper case, and empty tables are left out", async () => {
    const SQL = await loadSql(load, wasmUrl);
    const db = new SQL.Database();
    try {
      db.exec("CREATE TABLE mixed_case (a TEXT, b INTEGER)");
      db.exec("INSERT INTO mixed_case VALUES ('x', 1)");
      db.exec("CREATE TABLE empty_table (a TEXT)");
      const tables = dbToTables(db);
      assert.deepEqual(Object.keys(tables), ["MIXED_CASE"]);
      assert.deepEqual(parseCsv(tables.MIXED_CASE), { headers: ["a", "b"], rows: [["x", "1"]] });
    } finally {
      db.close();
    }
  });

  test("blobs, nulls and booleans render the way a table-file export writes them", () => {
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
    assert.equal(csvCell(new Uint8Array([1, 2, 3])), "1,2,3");
    assert.equal(csvCell(true), "1");
    assert.equal(csvCell(false), "0");
    assert.equal(csvCell(1791875700), "1791875700");
  });

  test("a null cell reads back as an empty cell", () => {
    const messy = 'heart rate up, "resting" after';
    const csv = tableToCsv({ columns: ["ID", "NOTE"], values: [["1", messy], ["2", null]] });
    const parsed = parseCsv(csv);
    // A row of one all-empty cell is dropped, exactly like the blank line it looks like.
    assert.equal(csv, 'ID,NOTE\n1,"heart rate up, ""resting"" after"\n2,\n');
    assert.deepEqual(parsed.headers, ["ID", "NOTE"]);
    assert.deepEqual(parsed.rows[0], ["1", messy]);
  });

  test("a table is quoted only where it has to be, so an export does not inflate", () => {
    const csv = tableToCsv({ columns: ["A", "B"], values: [["plain", "with,comma"], [1, 2]] });
    assert.equal(csv, 'A,B\nplain,"with,comma"\n1,2\n');
  });
});

// --- reading a file, whichever shape it is -------------------------------------------------

describe("readTables", () => {
  test("a database file reads straight to tables, with no zip in the way", async () => {
    const db = databaseBytes();
    const result = await read(db);
    assert.equal(result.shape, "database");
    assert.equal(result.expandedBytes, db.byteLength);
    assert.deepEqual(Object.keys(result.tables).sort(), Object.keys(EXPORT).sort());
    assert.ok(result.tables.HUAWEI_ACTIVITY_SAMPLE.startsWith("TIMESTAMP,HEART_RATE"));
  });

  test("a zip of table files keeps its layout and every CSV's text", async () => {
    const files = Object.fromEntries(csvFiles());
    const result = await read(zipBytes(Object.entries(files)));
    assert.equal(result.shape, "zip");
    assert.deepEqual(Object.keys(result.tables).sort(), Object.keys(files).map((name) => name.replace(/\.csv$/, "")).sort());
    assert.equal(result.tables.HUAWEI_SLEEP_STAGE_SAMPLE, new TextDecoder().decode(files["HUAWEI_SLEEP_STAGE_SAMPLE.csv"]));
    assert.ok(result.expandedBytes > 0);
  });

  test("a database nested in a zip is preferred over the table files beside it", async () => {
    const db = databaseBytes();
    const result = await read(zipBytes([
      [`${NESTED}/HUAWEI_ACTIVITY_SAMPLE.csv`, new TextEncoder().encode("TIMESTAMP,STEPS\n0,0\n")],
      [`${NESTED}/gadgetbridge.db`, db],
    ]));
    assert.equal(result.shape, "database");
    // The database won, and the decoy CSV's junk row is not what came back.
    assert.ok(result.tables.HUAWEI_ACTIVITY_SAMPLE.startsWith("TIMESTAMP,HEART_RATE"));
    assert.equal(result.expandedBytes, db.byteLength);
  });

  test("the extensionless name Gadgetbridge gives its own archive is recognised too", async () => {
    const result = await read(zipBytes([["gadgetbridge", databaseBytes()]]));
    assert.equal(result.shape, "database");
    assert.ok(result.tables.HUAWEI_WORKOUT_SUMMARY_SAMPLE);
  });

  test("the full data export is read from its database folder, not as a loose table", async () => {
    // "Mini Update.zip": the database keeps the Android app's own file name inside a
    // database folder, with the manifest, the preferences and the raw device files around it.
    const db = databaseBytes();
    const one = new TextEncoder().encode("{}");
    const result = await read(zipBytes([
      ["preferences/global.json", one],
      ["preferences/widget_steps.json", one],
      ["gadgetbridge.json", one],
      ["database/Gadgetbridge", db],
      ["files/2C:07:86:A9:F1:21/raw/GPS/1791875768620_17_5_gps.bin", new Uint8Array([1, 2, 3])],
    ]));
    assert.equal(result.shape, "database");
    assert.equal(result.expandedBytes, db.byteLength);
    assert.ok(result.tables.HUAWEI_ACTIVITY_SAMPLE.startsWith("TIMESTAMP,HEART_RATE"));
  });

  test("a zip holding neither a database nor table files is read as the table layout", async () => {
    const result = await read(zipBytes([["notes.txt", new TextEncoder().encode("hello")]]));
    assert.equal(result.shape, "zip");
    // Only a .csv or .zip suffix is stripped, so a loose file keeps the name it came with.
    assert.deepEqual(Object.keys(result.tables), ["NOTES.TXT"]);
  });

  test("a file that is neither shape is refused rather than read as a table", async () => {
    await assert.rejects(read(new TextEncoder().encode("just a text file")), /neither a Gadgetbridge zip nor a Gadgetbridge database/);
  });

  test("stored entries read exactly as deflated ones", async () => {
    const entries = csvFiles();
    const deflated = await read(zipBytes(entries));
    const stored = await read(zipBytes(entries, { deflate: false }));
    assert.deepEqual(stored.tables, deflated.tables);
    assert.equal(stored.expandedBytes, deflated.expandedBytes);
  });

  test("a comment after the directory does not hide it", async () => {
    const comment = "written by a phone file manager ".repeat(40);
    const result = await read(zipBytes(csvFiles(), { comment }));
    assert.equal(result.shape, "zip");
    assert.ok(result.tables.HUAWEI_ACTIVITY_SAMPLE);
  });

  test("an archive that expands past its budget is refused", async () => {
    await assert.rejects(read(zipBytes(csvFiles()), { maxExpandedBytes: 1024 }), /beyond the allowed import size/);
  });

  test("the wasm is decoded once and then shared, however many exports are read", async () => {
    const first = await loadSql(load, wasmUrl);
    let asked = 0;
    const other = (config) => { asked += 1; return initSqlJs({ locateFile: (file) => config.locateFile(file) }); };
    // A second loader is never consulted: the module keeps the instance sql.js handed back the
    // first time, so a multi-file import decodes the binary once.
    assert.equal(await loadSql(other, wasmUrl), first);
    assert.equal(asked, 0);
    await readTables(databaseBytes(), { load: other, wasmUrl });
    assert.equal(asked, 0);
  });

  test("the import budget is the one exports are sized against", () => {
    assert.equal(MAX_ZIP_EXPANDED_BYTES, 256_000_000);
  });
});

// --- the payoff: one export, two shapes, the same records ----------------------------------

// The whole feature rests on this: a database file has to produce the same days and the same
// workouts as the zip of table files would have. The two are read independently, then compared.
async function readBothShapes() {
  return {
    fromZip: await read(zipBytes(csvFiles())),
    fromDatabase: await read(databaseBytes()),
  };
}

// Mirrors what imports.js does: the day's resting heart rate is what the sessions are zoned
// against, so both have to be built together for the workout's strain to mean anything.
const recordsOf = (tables) => {
  const days = buildDays(tables, TZ, 0, sessionSpans(tables, TZ, 0));
  const restingByDate = Object.fromEntries(days.filter((day) => day.resting_hr != null).map((day) => [day.date, day.resting_hr]));
  return { days, workouts: buildWorkouts(tables, TZ, 0, restingByDate) };
};

// Which table a value came from is bookkeeping, not a measurement: the database says
// "activity_samples" for exactly the numbers a table file does.
const withoutSources = (day) => Object.fromEntries(Object.entries(day).filter(([key]) => key !== "sources"));

function assertSame(left, right, path) {
  if (Array.isArray(left) || Array.isArray(right)) {
    assert.ok(Array.isArray(left) && Array.isArray(right), `${path} is an array on one side only`);
    assert.equal(left.length, right.length, `${path} has different lengths`);
    return left.forEach((value, i) => assertSame(value, right[i], `${path}[${i}]`));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    assert.deepEqual(Object.keys(left).sort(), Object.keys(right).sort(), `${path} has different keys`);
    return Object.keys(left).forEach((key) => assertSame(left[key], right[key], `${path}.${key}`));
  }
  if (typeof left === "number" && typeof right === "number") {
    assert.ok(Number.isFinite(left) && Number.isFinite(right), `${path} is not a number on both sides`);
    return assert.ok(Math.abs(left - right) < 1e-9, `${path}: ${left} vs ${right}`);
  }
  assert.equal(left, right, `${path} differs`);
}

// A record's measured fields, which is what an import exists to produce. The device's own ids,
// labels and file locations are left out: they are text the device wrote, not a measurement.
const WORKOUT_FIELDS = [
  "date", "activity", "start_time", "end_time", "ended_at", "recovery_time_min", "timezone",
  "duration_min", "calories", "avg_hr", "max_hr", "min_hr", "strain", "zone_minutes", "method",
  "is_outdoor", "distance_km", "steps", "workout_load", "aerobic_effect", "anaerobic_effect",
  "ground_contact_ms", "vertical_oscillation_cm", "ground_time_balance_pct", "source",
];

describe("the database reads as the table files do", () => {
  test("both shapes carry the same tables", async () => {
    const { fromZip, fromDatabase } = await readBothShapes();
    assert.equal(fromZip.shape, "zip");
    assert.equal(fromDatabase.shape, "database");
    assert.deepEqual(Object.keys(fromDatabase.tables).sort(), Object.keys(fromZip.tables).sort());
  });

  test("every table parses to the same headers", async () => {
    const { fromZip, fromDatabase } = await readBothShapes();
    for (const name of Object.keys(fromZip.tables)) {
      assert.deepEqual(parseCsv(fromDatabase.tables[name]).headers, parseCsv(fromZip.tables[name]).headers, `${name} headers differ`);
    }
  });

  test("every day and every workout lands on the same values, read either way", async () => {
    const { fromZip, fromDatabase } = await readBothShapes();
    const a = recordsOf(fromZip.tables);
    const b = recordsOf(fromDatabase.tables);

    assertSame(b.days.map(withoutSources), a.days.map(withoutSources), "days");
    assert.equal(b.workouts.records.length, a.workouts.records.length, "workout counts differ");
    a.workouts.records.forEach((record, i) => {
      for (const field of WORKOUT_FIELDS) assertSame(b.workouts.records[i][field], record[field], `workouts[${i}].${field}`);
    });
    assert.deepEqual(b.workouts.crossCheck, a.workouts.crossCheck);
  });
});

// Parity alone would still pass if both shapes were wrong in the same way, so the day and the
// workout are also read against values worked out by hand from the fixture: the night is 330 staged
// minutes out of 360 (stage 5 is unmapped, and awake is staged but not slept), the day's resting
// heart rate is the watch's own value, the run's peak comes back from a signed byte, and every
// reading that should be skipped is.
test("the same export also lands on the values the fixture describes", async () => {
  const { fromZip, fromDatabase } = await readBothShapes();
  for (const tables of [fromZip.tables, fromDatabase.tables]) {
    const { days, workouts } = recordsOf(tables);
    assert.equal(days.length, 1, "one day is described");
    const [day] = days;
    assert.equal(day.date, "2026-03-08");
    assert.equal(day.timezone, TZ);
    assert.equal(day.source, "gadgetbridge_import");

    // The night: 360 stage rows, of which 10 are the unmapped code 5.
    assert.equal(day.light_minutes, 180);
    assert.equal(day.rem_minutes, 120);
    assert.equal(day.awake_minutes, 20);
    assert.equal(day.deep_minutes, 30);
    assert.equal(day.sleep_unknown_minutes, 10);
    assert.equal(day.sleep_minutes, 330);
    assert.equal(day.sleep_start, "2026-03-08T00:00");
    assert.equal(day.sleep_end, "2026-03-08T05:59");

    // The night's HRV, and the day's own sums. Calories arrive in hundredths of a kcal.
    assert.equal(day.hrv_samples_count, 20);
    assert.equal(day.hrv, 50);
    assert.equal(day.steps, 181 * 12);
    assert.equal(day.calories, Math.round((181 * 60) / 100));
    assert.equal(day.spo2, 98);
    assert.equal(day.skin_temp, 35);
    assert.equal(day.respiratory_rate, 14);
    assert.equal(day.resting_hr, 50);
    // One sample per two minutes across the night, ending before the 06:00 reading.
    assert.equal(day.rhr_samples_count, 180);
    assert.equal(day.sources.resting_hr, "overnight_hr_p05");
    // The overnight heart rate, all of it inside the sleep window.
    assert.equal(day.hr_covered, true);
    assert.deepEqual(day.zone_minutes_residual, [0, 0, 0, 0, 0]);

    // The run: an hour at 8 km/h, heart rate peaking at 142 after the signed byte is unwrapped.
    assert.equal(workouts.records.length, 1);
    const [workout] = workouts.records;
    assert.equal(workout.activity, "Outdoor running");
    assert.equal(workout.date, "2026-03-08");
    assert.equal(workout.start_time, "07:00");
    assert.equal(workout.end_time, "08:00");
    assert.equal(workout.ended_at, "2026-03-08T08:00:00.000Z");
    assert.equal(workout.duration_min, 60);
    assert.equal(workout.calories, 420);
    assert.equal(workout.distance_km, 8);
    assert.equal(workout.steps, 9000);
    assert.equal(workout.workout_load, 55);
    assert.equal(workout.aerobic_effect, 3.2);
    assert.equal(workout.anaerobic_effect, 1.4);
    assert.equal(workout.max_hr, 142);
    assert.equal(workout.min_hr, 60);
    assert.equal(workout.method, "hr_zones");
    assert.equal(workout.source, "gadgetbridge_import");
    // The shoes the watch reported, averaged over the stream: one value repeated is that value.
    assert.equal(workout.ground_contact_ms, 250);
    assert.equal(workout.vertical_oscillation_cm, 8.5);
    assert.equal(workout.ground_time_balance_pct, 50);
    // No GPS file was recorded, so the session is not treated as outdoors.
    assert.equal(workout.is_outdoor, false);
  }
});

test("nothing in a record is left as a NaN or an undefined", async () => {
  const { fromZip, fromDatabase } = await readBothShapes();
  for (const tables of [fromZip.tables, fromDatabase.tables]) {
    const { days, workouts } = recordsOf(tables);
    for (const day of days) {
      for (const [key, value] of Object.entries(day)) {
        assert.notEqual(value, undefined, `day.${key} is undefined`);
        if (typeof value === "number") assert.ok(Number.isFinite(value), `day.${key} is not finite`);
      }
    }
    for (const record of workouts.records) {
      for (const [key, value] of Object.entries(record)) {
        assert.notEqual(value, undefined, `workout.${key} is undefined`);
        if (typeof value === "number") assert.ok(Number.isFinite(value), `workout.${key} is not finite`);
      }
    }
  }
});

// A second export with none of the tables the readers look for: the tables arrive, and nothing is
// invented from them.
test("an export with no health tables produces no records at all", async () => {
  const result = await read(zipBytes([["device_info.csv", new TextEncoder().encode('"KEY","VALUE"\n"firmware","1.2"\n')]]));
  const { days, workouts } = recordsOf(result.tables);
  assert.deepEqual(days, []);
  assert.deepEqual(workouts.records, []);
  assert.equal(workouts.crossCheck, null);
});

// The fixture renders the same export twice, so the two renderings are also checked against each
// other where they can be: the number of tables, and the header of each.
test("both renderings describe the same export", () => {
  const files = csvFiles();
  assert.equal(files.length, Object.keys(EXPORT).length);
  for (const [name, table] of Object.entries(EXPORT)) {
    assert.equal(csvText(table).split("\n")[0], table.columns.map((column) => `"${column}"`).join(","), `${name} header`);
  }
});
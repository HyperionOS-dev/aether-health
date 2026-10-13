// A Gadgetbridge export, described once and rendered as the shapes it arrives in.
//
// Used by the test next to it, and built to be read on its own: an export is tens of megabytes, so
// nothing binary is kept in the repository. Instead the same tables are declared here and written
// out twice — as the CSV files a table-file export holds, and as the sqlite file a database export
// holds — which also keeps the two shapes honestly different rather than one being a copy of the
// other.
//
// Be careful about dates: they mean different things per shape.
//   * the table files hold ISO datetimes such as "2026-03-08T05:59:00.000Z" from a phone's export
//   * the database holds epoch seconds, the same number without a date attached
//   * a bare "2026-03-08" is a whole day, and both shapes use it that way
// The import normalises all three, which is what makes the two shapes interchangeable.

import { crc32, deflateRawSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

const START = Date.parse("2026-03-08T00:00:00Z") / 1000;
const at = (hours, minutes = 0) => START + hours * 3600 + minutes * 60;
const MINUTE = 60;

// Activity samples every two minutes for six hours: enough for the day to count as worn, with
// steps and calories in the dump's own units. The last row carries ordinary punctuation, which
// both CSV renderings have to escape.
const activityRows = [];
for (let m = 0; m <= 360; m += 2) {
  activityRows.push([START + m * MINUTE, 50 + (m % 10), 98, 12, 60, m === 360 ? 'heart rate up, "resting" after' : ""]);
}

// One stage row per minute. Stage 5 is unmapped, so its ten minutes count as unknown and stay out
// of the night's duration; the rest is light, rem, awake, deep.
const stageRows = [];
for (let m = 0; m < 360; m++) {
  const stage = m < 10 ? "5" : m < 190 ? "1" : m < 310 ? "2" : m < 330 ? "4" : "3";
  stageRows.push([START + m * MINUTE, stage]);
}

// Twenty spot HRV readings across twenty minutes of the night.
const hrvRows = [];
for (let m = 0; m < 20; m++) hrvRows.push([START + m * MINUTE, 40 + m]);

// The run's per-second heart rate. The peak above 127 arrives as a signed byte — -114 is 142, the
// case the unwrapping exists for.
const streamRows = [];
for (let s = 0; s <= 3600; s += 10) streamRows.push([42, at(7) + s, 100 + ((s / 10) % 50), 250, 8.5, 50]);

export const EXPORT = {
  HUAWEI_ACTIVITY_SAMPLE: {
    columns: ["TIMESTAMP", "HEART_RATE", "SPO2", "STEPS", "CALORIES", "NOTE"],
    rows: activityRows,
  },
  HUAWEI_SLEEP_STAGE_SAMPLE: {
    columns: ["TIMESTAMP", "STAGE"],
    rows: stageRows,
  },
  HUAWEI_HRV_VALUE_SAMPLE: {
    columns: ["TIMESTAMP", "VALUE"],
    rows: hrvRows,
  },
  HUAWEI_SLEEP_STATS_SAMPLE: {
    columns: ["BEDTIME", "RISINGTIME", "AVG_OXYGEN_SATURATION", "AVG_BREATH_RATE", "MIN_BREATH_RATE_BASELINE", "MAX_BREATH_RATE_BASELINE"],
    // The night belongs to the day it ends on, which is why the bed time is the one before it.
    rows: [[at(-2), at(6), 96, 14, 12, 16]],
  },
  HUAWEI_TEMPERATURE_SAMPLE: {
    columns: ["TIMESTAMP", "TEMPERATURE", "TEMPERATURE_TYPE"],
    // Only the type 2 skin reading counts, and only within a plausible range, so there is one row
    // of each kind that must be ignored.
    rows: [[at(2), 34.5, 2], [at(4), 35, 2], [at(5), 35.5, 2], [at(1), 30, 1], [at(7), 12, 2]],
  },
  HUAWEI_WORKOUT_SUMMARY_SAMPLE: {
    columns: [
      "WORKOUT_ID", "TYPE", "START_TIMESTAMP", "END_TIMESTAMP", "DURATION", "TOTAL_TIME", "CALORIES",
      "DISTANCE", "STEP_COUNT", "WORKOUT_LOAD", "WORKOUT_AEROBIC_EFFECT", "WORKOUT_ANAEROBIC_EFFECT",
      "MAX_HEART_RATE_PEAK", "MIN_HEART_RATE_PEAK", "GPX_FILE_LOCATION", "RAW_GPS_FILE_LOCATION",
      "RECOVERY_TIME", "EXTRA",
    ],
    // An hour outdoors at 8 km/h, and a blob — the kind of value only the database shape can hold
    // natively, which the table files write out as its decimal bytes.
    rows: [[42, 1, at(7), at(8), 3600, 3600, 420, 8000, 9000, 55, 3.2, 1.4, -114, 60, "", "", 162, new Uint8Array([1, 2, 3])]],
  },
  HUAWEI_WORKOUT_DATA_SAMPLE: {
    columns: ["WORKOUT_ID", "TIMESTAMP", "HEART_RATE", "GROUND_CONTACT_TIME", "VO", "GTB"],
    rows: streamRows,
  },
};

// The columns a table-file export writes as a date rather than a number.
const DATE_COLUMNS = new Set(["TIMESTAMP", "START_TIMESTAMP", "END_TIMESTAMP", "BEDTIME", "RISINGTIME"]);

// One table as the CSV file the table-file export holds: quoted cells, a spelled-out date in the
// date columns, and a blob as its decimal bytes.
export function csvText(table) {
  const header = table.columns.map((column) => `"${column}"`).join(",");
  const rows = table.rows.map((row) =>
    row
      .map((cell, i) => {
        if (cell instanceof Uint8Array) return `"${Array.from(cell).join(",")}"`;
        if (cell == null) return '""';
        if (DATE_COLUMNS.has(table.columns[i])) return `"${new Date(Number(cell) * 1000).toISOString()}"`;
        return `"${String(cell).replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

// Every table as a file name and its bytes, the way readZip hands them back.
export const csvFiles = () =>
  Object.entries(EXPORT).map(([name, table]) => [`${name}.csv`, new TextEncoder().encode(csvText(table))]);

// node's own sqlite writes a database file sql.js opens, so the fixture is made the way a real one
// is instead of being a copy of what this app happens to read.
export function databaseBytes() {
  const db = new DatabaseSync(":memory:");
  const value = (cell) => (cell instanceof Uint8Array ? Buffer.from(cell) : cell);
  try {
    for (const [name, table] of Object.entries(EXPORT)) {
      db.exec(`CREATE TABLE "${name}" (${table.columns.map((column) => `"${column}"`).join(", ")})`);
      const insert = db.prepare(`INSERT INTO "${name}" VALUES (${table.columns.map(() => "?").join(", ")})`);
      for (const row of table.rows) insert.run(...row.map(value));
    }
    return new Uint8Array(db.serialize());
  } finally {
    db.close();
  }
}

// --- writing zips -------------------------------------------------------------------------
//
// The reader is a hand-written central-directory walk, so the fixture must be a real archive rather
// than one written by the reader's own counterpart: it goes through zlib's deflate and node's crc32,
// which is what a phone's file manager would have produced.

function archiveEntry(name, data, { deflate }) {
  const nameBytes = new TextEncoder().encode(name);
  const body = deflate ? new Uint8Array(deflateRawSync(data)) : data;
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(deflate ? 8 : 0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.byteLength, 18);
  local.writeUInt32LE(data.byteLength, 22);
  local.writeUInt16LE(nameBytes.byteLength, 26);
  return { local, nameBytes, body, crc, size: data.byteLength, method: deflate ? 8 : 0 };
}

// A zip holding the entries in order, with a central directory at the end. Entries are stored
// (uncompressed) when asked, which the reader is expected to accept just as readily.
export function zipBytes(entries, { deflate = true, comment = "" } = {}) {
  const chunks = [];
  const directory = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const entry = archiveEntry(name, data, { deflate });
    chunks.push(Buffer.from(entry.local ?? []), Buffer.from(entry.nameBytes), Buffer.from(entry.body));
    directory.push({ entry, name: name, offset });
    offset += 30 + entry.nameBytes.byteLength + entry.body.byteLength;
  }
  const localBytes = offset;
  for (const { entry, name, offset: at } of directory) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.body.byteLength, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(entry.nameBytes.byteLength, 28);
    header.writeUInt32LE(at, 42);
    chunks.push(header, Buffer.from(entry.nameBytes));
    offset += header.byteLength + entry.nameBytes.byteLength;
  }
  const eocd = Buffer.alloc(22);
  const commentBytes = new TextEncoder().encode(comment);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(directory.length, 8);
  eocd.writeUInt16LE(directory.length, 10);
  eocd.writeUInt32LE(offset - localBytes, 12);
  eocd.writeUInt32LE(localBytes, 16);
  eocd.writeUInt16LE(commentBytes.byteLength, 20);
  chunks.push(eocd, Buffer.from(commentBytes));
  return new Uint8Array(Buffer.concat(chunks));
}
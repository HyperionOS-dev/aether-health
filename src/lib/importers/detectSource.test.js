import { test } from "node:test";
import assert from "node:assert/strict";
import { guessSource, zipEntryNames, GADGETBRIDGE, HUAWEI } from "./detectSource.js";

const bytes = (text) => new TextEncoder().encode(text);
const sqliteHead = bytes("SQLite format 3\0extra");
const fitHead = new Uint8Array(16);
fitHead.set(bytes(".FIT"), 8);
const zipHead = bytes("PK\u0003\u0004");

// A stored (uncompressed) zip with just a central directory, enough for the name reader.
function zipWith(names) {
  const parts = [];
  let dirLength = 0;
  for (const name of names) {
    const n = bytes(name);
    const rec = new Uint8Array(46 + n.length);
    const v = new DataView(rec.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(28, n.length, true);
    rec.set(n, 46);
    parts.push(rec);
    dirLength += rec.length;
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(10, names.length, true);
  ev.setUint32(12, dirLength, true);
  ev.setUint32(16, 0, true);
  const out = new Uint8Array(dirLength + 22);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  out.set(eocd, p);
  return out;
}

const readerFor = (data) => (start, end) => Promise.resolve(data.slice(start, end));
const namesIn = (list) => {
  const data = zipWith(list);
  return zipEntryNames(data.length, readerFor(data));
};

test("a SQLite database is Gadgetbridge whatever it is named", () => {
  assert.equal(guessSource("export.bin", sqliteHead), GADGETBRIDGE);
});

test("a FIT activity is Gadgetbridge whatever it is named", () => {
  assert.equal(guessSource("ride.fit", fitHead), GADGETBRIDGE);
  assert.equal(guessSource("renamed.bin", fitHead), GADGETBRIDGE);
});

test("a JSON file is Huawei", () => {
  assert.equal(guessSource("detail.json", bytes("[]")), HUAWEI);
});

test("a file with gadgetbridge in its name is Gadgetbridge, even as a zip", () => {
  assert.equal(guessSource("Gadgetbridge_tables.zip", zipHead, []), GADGETBRIDGE);
  assert.equal(guessSource("Gadgetbridge.db", zipHead), GADGETBRIDGE);
});

test("a zip with Gadgetbridge table names inside is Gadgetbridge", () => {
  const entries = ["HUAWEI_ACTIVITY_SAMPLE.csv", "HUAWEI_SLEEP_STAGE_SAMPLE.csv"];
  assert.equal(guessSource("export.zip", zipHead, entries), GADGETBRIDGE);
});

test("a zip holding a nested database is Gadgetbridge", () => {
  assert.equal(guessSource("backup.zip", zipHead, ["Gadgetbridge.db"]), GADGETBRIDGE);
});

test("a zip with mixed-case entries is Huawei", () => {
  assert.equal(guessSource("export.zip", zipHead, ["metrics.csv", "detail.json"]), HUAWEI);
  assert.equal(guessSource("export.zip", zipHead, []), HUAWEI);
});

test("an upper-case table name is Gadgetbridge, a mixed-case CSV name is Huawei", () => {
  assert.equal(guessSource("HUAWEI_ACTIVITY_SAMPLE.csv", bytes("a,b")), GADGETBRIDGE);
  assert.equal(guessSource("metrics.csv", bytes("a,b")), HUAWEI);
});

test("zipEntryNames reads every entry name from the central directory", async () => {
  const found = await namesIn(["A_TABLE.csv", "dir/B.csv", "c.json"]);
  assert.deepEqual(found, ["A_TABLE.csv", "dir/B.csv", "c.json"]);
});

test("zipEntryNames gives an empty list for bytes that are not a zip", async () => {
  const data = bytes("this is not a zip archive at all");
  assert.deepEqual(await zipEntryNames(data.length, readerFor(data)), []);
});

test("a file that is none of these is not guessed", () => {
  assert.equal(guessSource("notes.txt", bytes("hello")), null);
  assert.equal(guessSource("", new Uint8Array(0)), null);
});

test("an empty or short head does not match a signature", () => {
  assert.equal(guessSource("data.json", new Uint8Array(0)), HUAWEI);
  assert.equal(guessSource("unknown.bin", new Uint8Array(4)), null);
});

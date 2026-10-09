// Reading a Gadgetbridge table dump.
//
// The export arrives as a zip holding one CSV per table, so this is a zip reader
// (central directory + raw-deflate inflate), an RFC 4180 CSV reader, and the value
// readers every table goes through. Nothing here knows about health metrics — it
// only hands back rows and numbers.

const DECODER = new TextDecoder();

export type Table = { headers: string[]; rows: string[][] };

// This dump's missing-value sentinel, present in every metric column.
export const MISSING = -1;

export function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      // A doubled quote inside a quoted field is one literal quote — several
      // Huawei columns carry embedded JSON, so this cannot be skipped.
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string): Table {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  return { headers: splitRow(lines[0]), rows: lines.slice(1).map(splitRow) };
}

async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const body = new ArrayBuffer(raw.byteLength);
  new Uint8Array(body).set(raw);
  const stream = new Response(body).body!.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const tableName = (path: string) =>
  String(path.split("/").pop() || "").replace(/\.csv$/i, "").replace(/\.zip$/i, "").toUpperCase();

// Every CSV in the archive, keyed by table name.
export async function readZip(bytes: Uint8Array): Promise<Record<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That file is not a zip archive");

  const out: Record<string, string> = {};
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < view.getUint16(eocd + 10, true); i++) {
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const name = DECODER.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const local = view.getUint32(p + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + csize);
    out[tableName(name)] = DECODER.decode(method === 0 ? raw : await inflateRaw(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// A loose CSV upload becomes a one-table dump, keyed by the file's own name.
export function singleTable(name: string, text: string): Record<string, string> {
  return { [tableName(name)]: text };
}

export function tableOf(files: Record<string, string>, name: string): Table | null {
  const key = Object.keys(files).find((k) => k.startsWith(name.toUpperCase()));
  return key ? parseCsv(files[key]) : null;
}

export function col(headers: string[], ...names: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const name of names) {
    const i = norm.indexOf(name.toLowerCase());
    if (i >= 0) return i;
  }
  for (const name of names) {
    const i = norm.findIndex((h) => h.includes(name.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}

// Any finite number, negatives included — peak columns arrive negative and must not
// be dropped before the signed-byte fix runs.
export function num(row: string[], i: number): number | null {
  if (i < 0 || row[i] == null || row[i] === "") return null;
  const n = Number(row[i]);
  return Number.isFinite(n) ? n : null;
}

// A metric value, with the dump's -1 sentinel read as absent.
export function metric(row: string[], i: number): number | null {
  const n = num(row, i);
  return n == null || n === MISSING ? null : n;
}

// FIX 8 — Huawei writes some heart-rate fields as signed bytes, so a true value above
// 127 arrives negative: -114 is 142. Unwrap before the value is used anywhere, then
// check it against a humanly possible range; anything outside it is treated as absent.
const HR_FLOOR = 30;
const HR_CEIL = 220;

export function fromSignedByte(v: number): number {
  return v < 0 ? v + 256 : v;
}

export function saneHeartRate(v: number | null): number | null {
  if (v == null) return null;
  const fixed = fromSignedByte(v);
  return fixed >= HR_FLOOR && fixed <= HR_CEIL ? fixed : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

// Local offset for one instant, in minutes. An IANA zone is resolved per timestamp,
// so a dump spanning a daylight-saving change still lands on the correct local days;
// the numeric offset is the fallback when the runtime cannot resolve the zone.
export function offsetMinutes(utcMs: number, zone: string, fallback: number): number {
  if (!zone) return fallback;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(utcMs));
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - utcMs) / 60000);
  } catch {
    return fallback;
  }
}

// Minutes since the epoch on the local wall clock. Every day attribution in the
// importer works on this scale, so a UTC timestamp cannot be filed under the wrong day.
export function localMinutes(utcMs: number, zone: string, fallback: number): number {
  return Math.round((utcMs + offsetMinutes(utcMs, zone, fallback) * 60000) / 60000);
}

export function localDate(localMin: number): string {
  const d = new Date(localMin * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function localIso(localMin: number): string {
  const d = new Date(localMin * 60000);
  return `${localDate(localMin)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function localClock(localMin: number): string {
  const d = new Date(localMin * 60000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function dayStart(localMin: number): number {
  return Math.floor(localMin / 1440) * 1440;
}
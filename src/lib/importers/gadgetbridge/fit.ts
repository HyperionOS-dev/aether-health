// Gadgetbridge's own FIT activity files, read in the browser.
//
// A FIT file is a binary log: a header, then definition messages that name the fields of the data
// messages after them. Only the two messages a session needs are kept: the session summary (18) and
// its per-second records (20), where position and heart rate live. Every other message is skipped by
// its declared size, so the reader does not need the whole profile.
//
// A session becomes the same workout record the table importer builds, so strain, zones and the
// cross-check treat both sources alike. What the file does not carry stays null rather than guessed:
// a FIT session has no WORKOUT_LOAD or aerobic effect, and no ground-contact columns.
//
// The file's CRC is not checked. A truncated file is caught by its declared data size instead.

import { COVERAGE_MIN, pickMethod, strainFor, zoneMinutes, type Point } from "./workouts.ts";
import { localClock, localDate, localMinutes, saneHeartRate } from "./tables.ts";

const SOURCE = "gadgetbridge_import";
const FIT_HEADER_MIN = 12;
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31); // FIT counts seconds from 1989-12-31 UTC
const SEMICIRCLE_DEG = 180 / 2 ** 31; // GPS is stored in semicircles
const SESSION_MESG = 18;
const RECORD_MESG = 20;
const TIMESTAMP = 253;

// Field numbers from the FIT profile, for the two messages this reader keeps.
const SESSION = { start: 2, sport: 5, subSport: 6, elapsed: 7, timer: 8, distance: 9, strides: 10, calories: 11, avgHr: 16, maxHr: 17 };
const RECORD = { lat: 0, lon: 1, hr: 3 };
const WANTED = new Map<number, Set<number>>([
  [SESSION_MESG, new Set(Object.values(SESSION))],
  [RECORD_MESG, new Set(Object.values(RECORD))],
]);
// Every message's own timestamp is kept, so a compressed header after any message keeps the clock.

// Bytes per value, for the base types read as plain numbers.
const WIDTH: Record<number, number> = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4 };

type FieldDef = { num: number; size: number; base: number };
type MessageDef = { global: number; little: boolean; fields: FieldDef[]; devBytes: number };

export type FitSession = {
  start: number; // UTC milliseconds
  elapsedS: number;
  timerS: number;
  distanceM: number;
  steps: number;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  sport: number | null;
  subSport: number | null;
};
export type FitPoint = { ms: number; lat: number | null; lon: number | null; hr: number | null };

export function isFit(bytes: Uint8Array): boolean {
  // The signature ".FIT" sits at bytes 8 to 11 of every FIT file.
  return bytes.length >= FIT_HEADER_MIN && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}

// A value the device could not measure is stored as the type's maximum and reads as absent.
function readScalar(view: DataView, at: number, base: number, little: boolean): number | null {
  switch (base) {
    case 0:
    case 2: {
      const v = view.getUint8(at);
      return v === 0xff ? null : v;
    }
    case 1: {
      const v = view.getInt8(at);
      return v === 0x7f ? null : v;
    }
    case 3: {
      const v = view.getInt16(at, little);
      return v === 0x7fff ? null : v;
    }
    case 4: {
      const v = view.getUint16(at, little);
      return v === 0xffff ? null : v;
    }
    case 5: {
      const v = view.getInt32(at, little);
      return v === 0x7fffffff ? null : v;
    }
    case 6: {
      const v = view.getUint32(at, little);
      return v === 0xffffffff ? null : v;
    }
    default:
      return null;
  }
}

function readField(view: DataView, at: number, field: FieldDef, little: boolean): number | null {
  const width = WIDTH[field.base];
  if (width === undefined || field.size < width) return null;
  return readScalar(view, at, field.base, little);
}

// A compressed header carries only the low five bits of the timestamp; the rest carries over.
function fromCompressed(last: number, offset: number): number {
  const low = last % 32;
  return last - low + (offset < low ? 32 : 0) + offset;
}

function degrees(raw: number | null, limit: number): number | null {
  if (raw == null) return null;
  const deg = raw * SEMICIRCLE_DEG;
  return Math.abs(deg) <= limit ? deg : null;
}

// Reads a definition message whose header byte sits at headerAt. Layout: header, reserved,
// architecture, global message number (two bytes), field count, then three bytes per field.
function readDefinition(bytes: Uint8Array, headerAt: number, hasDev: boolean): { def: MessageDef; next: number } {
  let p = headerAt + 2; // past the header and reserved bytes, onto the architecture byte
  const little = bytes[p++] === 0;
  const global = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(p, little);
  p += 2;
  const count = bytes[p++];
  const fields: FieldDef[] = [];
  for (let i = 0; i < count; i++) {
    fields.push({ num: bytes[p], size: bytes[p + 1], base: bytes[p + 2] & 0x1f });
    p += 3;
  }
  let devBytes = 0;
  if (hasDev) {
    const devCount = bytes[p++];
    for (let i = 0; i < devCount; i++) {
      devBytes += bytes[p + 1];
      p += 3;
    }
  }
  return { def: { global, little, fields, devBytes }, next: p };
}

export function decodeFit(bytes: Uint8Array): { sessions: FitSession[]; points: FitPoint[] } {
  if (!isFit(bytes)) throw new Error("That file is not a FIT activity file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0];
  if (headerSize < FIT_HEADER_MIN) throw new Error("That FIT file has a damaged header");
  const end = Math.min(bytes.length, headerSize + view.getUint32(4, true));
  const defs = new Map<number, MessageDef>();
  const sessions: FitSession[] = [];
  const points: FitPoint[] = [];
  let last = 0; // the most recent timestamp, in seconds since the FIT epoch
  let p = headerSize;

  while (p < end) {
    const header = bytes[p];
    const compressed = (header & 0x80) !== 0;
    const local = compressed ? (header >> 5) & 0x03 : header & 0x0f;

    if (!compressed && (header & 0x40) !== 0) {
      const parsed = readDefinition(bytes, p, (header & 0x20) !== 0);
      defs.set(local, parsed.def);
      p = parsed.next;
      continue;
    }
    p++;

    const def = defs.get(local);
    // A data message before its definition means the layout is unknown from here on.
    if (!def) break;
    const size = def.fields.reduce((sum, f) => sum + f.size, 0) + def.devBytes;
    // A record cut off by the end of the file is dropped rather than read past it.
    if (p + size > end) break;

    const wanted = WANTED.get(def.global);
    const values = new Map<number, number | null>();
    for (const field of def.fields) {
      if (field.num === TIMESTAMP || wanted?.has(field.num)) values.set(field.num, readField(view, p, field, def.little));
      p += field.size;
    }
    p += def.devBytes;

    const explicit = values.get(TIMESTAMP);
    let stamp: number | null = null;
    if (explicit != null) stamp = explicit;
    else if (compressed) stamp = fromCompressed(last, header & 0x1f);
    if (stamp != null) last = stamp;

    if (def.global === SESSION_MESG) {
      const start = values.get(SESSION.start);
      if (start == null) continue;
      sessions.push({
        start: FIT_EPOCH_MS + start * 1000,
        elapsedS: (values.get(SESSION.elapsed) ?? 0) / 1000,
        timerS: (values.get(SESSION.timer) ?? 0) / 1000,
        distanceM: (values.get(SESSION.distance) ?? 0) / 100,
        steps: values.get(SESSION.strides) ?? 0,
        calories: values.get(SESSION.calories) ?? null,
        avgHr: values.get(SESSION.avgHr) ?? null,
        maxHr: values.get(SESSION.maxHr) ?? null,
        sport: values.get(SESSION.sport) ?? null,
        subSport: values.get(SESSION.subSport) ?? null,
      });
    } else if (def.global === RECORD_MESG && stamp != null) {
      points.push({
        ms: FIT_EPOCH_MS + stamp * 1000,
        lat: degrees(values.get(RECORD.lat) ?? null, 90),
        lon: degrees(values.get(RECORD.lon) ?? null, 180),
        hr: values.get(RECORD.hr) ?? null,
      });
    }
  }

  return { sessions, points: points.sort((a, b) => a.ms - b.ms) };
}

// FIT's own sport codes, which are a different numbering from the table dump's TYPE codes.
// Indoor and outdoor running are told apart by GPS, the same rule sports.ts applies.
export function fitActivityLabel(sport: number | null, hasGps: boolean): string {
  if (sport === 1) return hasGps ? "Outdoor running" : "Indoor running";
  if (sport === 11) return "Walking";
  return "Workout";
}

export function buildFitWorkouts(bytes: Uint8Array, timezone: string, fallbackOffset: number, restingByDate: Record<string, number>) {
  const { sessions, points } = decodeFit(bytes);
  const records: Record<string, any>[] = [];

  for (const s of sessions) {
    const durationMin = Math.round((s.timerS || s.elapsedS) / 60);
    if (durationMin <= 0) continue;
    const endMs = s.start + s.elapsedS * 1000;
    const inside = points.filter((pt) => pt.ms >= s.start && pt.ms <= endMs);
    const samples: Point[] = inside.map((pt) => ({
      t: localMinutes(pt.ms, timezone, fallbackOffset),
      hr: saneHeartRate(pt.hr),
      gct: null,
      vo: null,
      gtb: null,
    }));
    const good = samples.filter((p) => p.hr != null) as (Point & { hr: number })[];
    const coverage = samples.length ? good.length / samples.length : 0;

    const local = localMinutes(s.start, timezone, fallbackOffset);
    const date = localDate(local);
    const distanceKm = s.distanceM / 1000;
    const rhr = restingByDate[date] ?? null;
    const zones = rhr != null && coverage >= COVERAGE_MIN ? zoneMinutes(good, rhr) : null;
    // Heart-rate zones only count when a resting rate exists to build them from; without one the
    // method falls through to pace, rather than picking zones that strainFor cannot score.
    const method = pickMethod(zones ? coverage : 0, distanceKm, s.steps, null, null, null);
    const strain = strainFor(method, { zones, distanceKm, durationMin, steps: s.steps });
    const hasGps = inside.some((pt) => pt.lat != null);

    const avgHr = saneHeartRate(s.avgHr) ?? (coverage >= COVERAGE_MIN && good.length ? Math.round(good.reduce((sum, p) => sum + p.hr, 0) / good.length) : null);
    const maxHr = saneHeartRate(s.maxHr) ?? (good.length ? Math.max(...good.map((p) => p.hr)) : null);

    records.push({
      date,
      activity: fitActivityLabel(s.sport, hasGps),
      start_time: localClock(local),
      end_time: localClock(localMinutes(endMs, timezone, fallbackOffset)),
      ended_at: new Date(endMs).toISOString(),
      recovery_time_min: null,
      timezone,
      duration_min: durationMin,
      calories: s.calories,
      avg_hr: avgHr,
      max_hr: maxHr,
      min_hr: null,
      strain,
      zone_minutes: zones,
      source: SOURCE,
      method,
      is_outdoor: hasGps,
      distance_km: distanceKm > 0 ? Math.round(distanceKm * 100) / 100 : null,
      steps: s.steps > 0 ? s.steps : null,
      workout_load: null,
      aerobic_effect: null,
      anaerobic_effect: null,
      ground_contact_ms: null,
      vertical_oscillation_cm: null,
      ground_time_balance_pct: null,
    });
  }

  return { records, crossCheck: null };
}

// A FIT session and a database workout are the same session when they fall on the same date, share a
// sport family, and start and end within this many minutes of each other.
const DUPLICATE_TOLERANCE_MIN = 2;

// Running is one family whether the device called it indoor or outdoor; every other label stands alone.
export function sportFamily(activity: string): string {
  return /running$/i.test(activity) ? "running" : activity.toLowerCase();
}

// Clock times are the "HH:MM" strings the importers write, so they compare as minutes since midnight.
function clockMinutes(clock: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(clock ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Splits FIT workouts into those to keep and those that duplicate a database workout. The database
// workout always wins: the FIT copy is dropped and reported, so the caller can say so.
export function findFitDuplicates(database: Record<string, any>[], fit: Record<string, any>[]) {
  const kept: Record<string, any>[] = [];
  const skipped: { activity: string; date: string; start_time: string }[] = [];
  for (const w of fit) {
    const start = clockMinutes(w.start_time);
    const end = clockMinutes(w.end_time);
    const duplicate = start != null && end != null && database.some((d) => {
      const dStart = clockMinutes(d.start_time);
      const dEnd = clockMinutes(d.end_time);
      return d.date === w.date
        && dStart != null && dEnd != null
        && sportFamily(String(d.activity)) === sportFamily(String(w.activity))
        && Math.abs(dStart - start) <= DUPLICATE_TOLERANCE_MIN
        && Math.abs(dEnd - end) <= DUPLICATE_TOLERANCE_MIN;
    });
    if (duplicate) skipped.push({ activity: w.activity, date: w.date, start_time: w.start_time });
    else kept.push(w);
  }
  return { kept, skipped };
}

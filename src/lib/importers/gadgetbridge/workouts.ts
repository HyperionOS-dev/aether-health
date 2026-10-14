// Workout records from a Gadgetbridge dump.
//
// FIX 8 — Huawei writes several heart-rate fields as signed bytes, so a true value
// above 127 arrives negative: -114 is 142. That applies to the summary's peak columns
// AND to the per-second HEART_RATE stream in HUAWEI_WORKOUT_DATA — unwrapped, each
// stream's maximum matches its own fixed MAX_HEART_RATE_PEAK exactly. Every heart-rate
// field therefore goes through fromSignedByte() and then a 30-220 sanity band, and a
// value that still fails the band is treated as absent rather than stored. If the
// summary's peaks fail the check, they are ignored and max/min come from the stream.
//
// FIX 9 — the strain method is chosen from what data exists, never from the sport code.
// A badminton session, an unclassified future sport, and a run whose watch failed to
// log distance all take the same decision path, in this order:
//   1. per-second heart rate with at least half its samples usable -> time in HR zones
//   2. distance or step count            -> pace / cadence estimate
//   3. WORKOUT_LOAD / aerobic / anaerobic effect -> a moderate-effort proxy
//   4. nothing                           -> 0
// Whatever the device reported is kept on the record even when method 1 wins, so the
// zone thresholds can be checked against Huawei's own load later.

import { strainFromMet, strainFromZones, zoneForHr, zoneLoad } from "@/lib/scoring/scores";
import { activityLabel, isOutdoor } from "./sports.ts";
import { col, localClock, localDate, localMinutes, metric, num, saneHeartRate, tableOf, timestampMs } from "./tables.ts";

const GAP_CAP_MIN = 5; // a wider gap carries no zone credit — the watch was not recording
export const COVERAGE_MIN = 0.5; // FIX 9 method 1: half the samples must survive the sanity band
const SOURCE = "gadgetbridge_import";

// Pace and cadence bands for a session whose heart rate is unusable. MET values follow
// the same compendium as the manual workout logger, so an estimated session and a
// hand-logged one are weighed on one scale.
const PACE_BANDS = [
  { maxKmh: 6.5, met: 3.5 },
  { maxKmh: 9, met: 8 },
  { maxKmh: Infinity, met: 11.5 },
];
const CADENCE_BANDS = [
  { maxSpm: 110, met: 3.5 },
  { maxSpm: 140, met: 8 },
  { maxSpm: Infinity, met: 11.5 },
];
// A session happened but its intensity did not survive: the same default the manual
// logger uses for an activity it does not know.
const UNKNOWN_EFFORT_MET = 5;

// Wide, physical guard rails — they only exclude nonsense, not real values.
const GCT_MS = [50, 800];
const VO_CM = [1, 30];
const GTB_PCT = [30, 70];

export type Point = { t: number; hr: number | null; gct: number | null; vo: number | null; gtb: number | null };

const banded = (v: number | null, lo: number, hi: number) => (v != null && v >= lo && v <= hi ? v : null);
const mean = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
const metForSpeed = (kmh: number) => (PACE_BANDS.find((b) => kmh <= b.maxKmh) || PACE_BANDS[PACE_BANDS.length - 1]).met;
const metForCadence = (spm: number) => (CADENCE_BANDS.find((b) => spm <= b.maxSpm) || CADENCE_BANDS[CADENCE_BANDS.length - 1]).met;

// Time in each zone across one workout's own trace, credited minute by minute with a
// gap cap, exactly as the day's full trace is credited.
export function zoneMinutes(points: Point[], rhr: number): number[] {
  const zones = [0, 0, 0, 0, 0];
  let prev: number | null = null;
  let prevZone = -1;
  for (const p of points) {
    if (p.hr == null) continue;
    if (prev != null) {
      const dt = Math.min(GAP_CAP_MIN, p.t - prev);
      if (dt > 0 && prevZone >= 0) zones[prevZone] += dt;
    }
    prev = p.t;
    prevZone = zoneForHr(p.hr, rhr);
  }
  return zones;
}

function buildStreams(data: { headers: string[]; rows: string[][] } | null, timezone: string, fallbackOffset: number): Map<string, Point[]> {
  const streams = new Map<string, Point[]>();
  if (!data) return streams;
  const iId = col(data.headers, "workoutid");
  const iTs = col(data.headers, "timestamp");
  const iHr = col(data.headers, "heartrate");
  const iGct = col(data.headers, "groundcontacttime");
  const iVo = col(data.headers, "vo");
  const iGtb = col(data.headers, "gtb");
  for (const row of data.rows) {
    const id = String(row[iId] ?? "");
    const ms = timestampMs(row[iTs]);
    if (!id || !Number.isFinite(ms)) continue;
    if (!streams.has(id)) streams.set(id, []);
    streams.get(id)!.push({
      t: localMinutes(ms, timezone, fallbackOffset),
      hr: saneHeartRate(num(row, iHr)),
      gct: metric(row, iGct),
      vo: metric(row, iVo),
      gtb: metric(row, iGtb),
    });
  }
  for (const arr of streams.values()) arr.sort((a, b) => a.t - b.t);
  return streams;
}

// FIX 3 — the span each session occupied, by local date, in the same minute space as the
// day's own heart-rate trace. The day's zones are read twice: whole, and with these spans
// removed, so a session's minutes are never counted both in the trace and again as the
// session's own strain. Read from the same summary table the records themselves use.
export function sessionSpans(tables: Record<string, string>, timezone: string, fallbackOffset: number) {
  const spans = new Map<string, { from: number; to: number }[]>();
  const summary = tableOf(tables, "HUAWEI_WORKOUT_SUMMARY_SAMPLE");
  if (!summary) return spans;
  const iStart = col(summary.headers, "starttimestamp");
  const iEnd = col(summary.headers, "endtimestamp");
  const iDur = col(summary.headers, "duration");
  const iTotal = col(summary.headers, "totaltime");
  for (const row of summary.rows) {
    const ms = timestampMs(row[iStart]);
    if (!Number.isFinite(ms)) continue;
    const minutes = Math.round(((metric(row, iDur) ?? metric(row, iTotal)) ?? 0) / 60);
    if (minutes <= 0) continue;
    const from = localMinutes(ms, timezone, fallbackOffset);
    const date = localDate(from);
    const endMs = timestampMs(row[iEnd]);
    const to = Number.isFinite(endMs) ? localMinutes(endMs, timezone, fallbackOffset) : from + minutes;
    if (!spans.has(date)) spans.set(date, []);
    spans.get(date)!.push({ from, to });
  }
  return spans;
}

export function pickMethod(coverage: number, distanceKm: number, steps: number, load: number | null, aerobic: number | null, anaerobic: number | null): string {
  if (coverage >= COVERAGE_MIN) return "hr_zones";
  if (distanceKm > 0) return "pace";
  if (steps > 0) return "steps";
  if (load != null || aerobic != null || anaerobic != null) return "device_effects";
  return "none";
}

export function strainFor(method: string, x: { zones: number[] | null; distanceKm: number; durationMin: number; steps: number }): number {
  if (method === "hr_zones" && x.zones) return strainFromZones(x.zones);
  if (method === "pace") return strainFromMet(x.durationMin, metForSpeed(x.distanceKm / (x.durationMin / 60)));
  if (method === "steps") return strainFromMet(x.durationMin, metForCadence(x.steps / x.durationMin));
  if (method === "device_effects") return strainFromMet(x.durationMin, UNKNOWN_EFFORT_MET);
  return 0;
}

// The standing cross-check FIX 9 asks for: our own zone load against Huawei's
// on-device load, over every session that can be weighed both ways.
function crossCheck(ratios: number[]) {
  if (!ratios.length) return null;
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { pairs: ratios.length, medianRatio: Math.round(median * 100) / 100 };
}

export function buildWorkouts(tables: Record<string, string>, timezone: string, fallbackOffset: number, restingByDate: Record<string, number>) {
  const summary = tableOf(tables, "HUAWEI_WORKOUT_SUMMARY_SAMPLE");
  if (!summary) return { records: [], crossCheck: null };
  const streams = buildStreams(tableOf(tables, "HUAWEI_WORKOUT_DATA_SAMPLE"), timezone, fallbackOffset);

  const i = (name: string) => col(summary.headers, name);
  const [iId, iType, iStart, iEnd, iDur, iTotal, iCal, iDist, iSteps, iLoad, iAer, iAna, iMaxPeak, iMinPeak, iGpx, iRawGps, iRecoveryTime] = [
    i("workoutid"), i("type"), i("starttimestamp"), i("endtimestamp"), i("duration"), i("totaltime"), i("calories"),
    i("distance"), i("stepcount"), i("workoutload"), i("workoutaerobiceffect"), i("workoutanaerobiceffect"),
    i("maxheartratepeak"), i("minheartratepeak"), i("gpxfilelocation"), i("rawgpsfilelocation"),
    i("recoverytime"),
  ];

  const records: Record<string, any>[] = [];
  const ratios: number[] = [];

  for (const row of summary.rows) {
    const id = String(row[iId] ?? "");
    const startMs = timestampMs(row[iStart]);
    if (!id || !Number.isFinite(startMs)) continue;

    const local = localMinutes(startMs, timezone, fallbackOffset);
    const date = localDate(local);
    const points = streams.get(id) || [];
    const good = points.filter((p) => p.hr != null) as (Point & { hr: number })[];
    const coverage = points.length ? good.length / points.length : 0;
    const durationMin = Math.round(((metric(row, iDur) ?? metric(row, iTotal)) ?? 0) / 60);
    const distanceKm = (metric(row, iDist) ?? 0) / 1000;
    const steps = metric(row, iSteps) ?? 0;
    const load = metric(row, iLoad);
    const aerobic = metric(row, iAer);
    const anaerobic = metric(row, iAna);
    const rhr = restingByDate[date] ?? null;

    // FIX 8 — peaks unwrapped and checked; the stream answers when the check fails.
    let maxHr = saneHeartRate(num(row, iMaxPeak));
    let minHr = saneHeartRate(num(row, iMinPeak));
    if (maxHr == null && good.length) maxHr = Math.max(...good.map((p) => p.hr));
    if (minHr == null && good.length) minHr = Math.min(...good.map((p) => p.hr));

    const avgHr = coverage >= COVERAGE_MIN && good.length ? Math.round(good.reduce((s, p) => s + p.hr, 0) / good.length) : null;
    const zones = rhr != null && coverage >= COVERAGE_MIN ? zoneMinutes(good, rhr) : null;
    const method = pickMethod(coverage, distanceKm, steps, load, aerobic, anaerobic);
    const strain = strainFor(method, { zones, distanceKm, durationMin, steps });
    // Load against load: strain saturates at 21, so weighing the finished score against
    // the watch's own load would hide exactly the disagreement this check exists to find.
    if (method === "hr_zones" && zones && load != null && load > 0) ratios.push(zoneLoad(zones) / load);

    records.push({
      date,
      activity: activityLabel(num(row, iType)),
      start_time: localClock(local),
      end_time: Number.isFinite(timestampMs(row[iEnd]))
        ? localClock(localMinutes(timestampMs(row[iEnd]), timezone, fallbackOffset))
        : null,
      ended_at: Number.isFinite(timestampMs(row[iEnd])) ? new Date(timestampMs(row[iEnd])).toISOString() : null,
      recovery_time_min: metric(row, iRecoveryTime),
      timezone,
      duration_min: durationMin,
      calories: metric(row, iCal),
      avg_hr: avgHr,
      max_hr: maxHr,
      min_hr: minHr,
      strain,
      // FIX 9 — the session's own per-second-stream zone minutes, kept on the record so
      // the bio-age aerobic factor can add them to the day's residual under the additive
      // rule. Null when method 1 did not win (no usable HR stream); the consumer then
      // falls back to this session's average-HR zone.
      zone_minutes: zones,
      source: SOURCE,
      method,
      // Where it happened is read from the GPS file columns, not from the sport code:
      // a type 1 run with no GPS fix is still an outdoor session.
      is_outdoor: isOutdoor({ gpx: row[iGpx] ?? null, rawGps: row[iRawGps] ?? null }),
      distance_km: distanceKm > 0 ? Math.round(distanceKm * 100) / 100 : null,
      steps: steps > 0 ? steps : null,
      workout_load: load,
      aerobic_effect: aerobic,
      anaerobic_effect: anaerobic,
      ground_contact_ms: mean(points.map((p) => p.gct).filter((v): v is number => banded(v, GCT_MS[0], GCT_MS[1]) != null)),
      vertical_oscillation_cm: mean(points.map((p) => p.vo).filter((v): v is number => banded(v, VO_CM[0], VO_CM[1]) != null)),
      ground_time_balance_pct: mean(points.map((p) => p.gtb).filter((v): v is number => banded(v, GTB_PCT[0], GTB_PCT[1]) != null)),
    });
  }

  return { records, crossCheck: crossCheck(ratios) };
}
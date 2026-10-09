// Parsing for Huawei Health exports: raw per-minute metric CSVs
// (heart rate, SpO2, steps, weight, sleep stages).
//
// Sleep rows are timestamped stage segments, so this keeps the sleep window and the
// timestamped heart-rate trace of every day. Heart rate is held as a packed
// [minute, bpm, minute, bpm, ...] list under `_hr` and never reaches the database:
// finalizeDay() turns it into resting HR and time-in-zone, then drops it.

import { zoneForHr } from "../../scoring/scores.js";

export type ParsedData = { days: Record<string, any>[]; workouts: Record<string, any>[] };

const DATE_RE = /(\d{4})[.\/-](\d{2})[.\/-](\d{2})(?:[ T](\d{2}):(\d{2}))?/;
const HR_MIN = 30; // plausible overnight resting floor
const HR_MAX = 120; // plausible overnight resting ceiling
const GAP_CAP = 5; // minutes a single reading may stand for
const COVER_SPAN = 360; // minutes of estimated wear before the HR trace is trusted
const COVER_COUNT = 60; // readings needed to go with it
const MIN_POOL = 10; // overnight readings needed before the sleep window is used instead of the whole day

const pad = (n: number) => String(n).padStart(2, "0");
const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === "," && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim());
  if (!lines.length) return { headers: [] as string[], rows: [] as string[][] };
  return { headers: splitRow(lines[0]), rows: lines.slice(1).map(splitRow) };
}

// "2026.08.04 10:58:00" -> { date, hour, minutes } where minutes is a
// timezone-free minute stamp used for all timing maths.
function stamp(s: string) {
  const m = String(s).match(DATE_RE);
  if (!m) return null;
  const hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    hour,
    minutes: Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute) / 60000,
  };
}

const toIso = (minutes: number) => {
  const d = new Date(minutes * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

const epoch = (iso: string) => Date.parse(iso.length === 16 ? `${iso}:00Z` : iso) / 60000;

function nextDay(date: string) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Mean of the values between two percentile positions. Steadier than a single
// percentile value, and far less exposed to a few bad readings than the mean of a
// bottom bucket, which a handful of artifacts can drag away.
function band(arr: number[], lo: number, hi: number) {
  const s = [...arr].sort((a, b) => a - b);
  const from = Math.min(s.length - 1, Math.floor(s.length * lo));
  const to = Math.max(from, Math.min(s.length - 1, Math.round(s.length * hi) - 1));
  let sum = 0;
  for (let i = from; i <= to; i++) sum += s[i];
  return sum / (to - from + 1);
}

function packPoints(raw: any): number[][] | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const pairs: number[][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    if (typeof raw[i] === "number" && typeof raw[i + 1] === "number") pairs.push([raw[i], raw[i + 1]]);
  }
  if (pairs.length < 2) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs;
}

function slicePoints(pts: number[][], from: number, to: number) {
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] < from) lo = mid + 1;
    else hi = mid;
  }
  const out: number[][] = [];
  for (let i = lo; i < pts.length && pts[i][0] <= to; i++) out.push(pts[i]);
  return out;
}

const STAGES: Record<string, string> = {
  awake: "awake_minutes", wake: "awake_minutes",
  light: "light_minutes", lightsleep: "light_minutes", sleep: "light_minutes",
  deep: "deep_minutes", deepsleep: "deep_minutes",
  rem: "rem_minutes", remsleep: "rem_minutes",
};

const NAP_GAP_MIN = 90; // a gap wider than this separates a nap from the night

const toClock = (m: number) => {
  const d = new Date(m * 60000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

const DAY_FIELDS = [
  "hrv", "resting_hr", "steps", "weight", "spo2", "calories",
  "sleep_minutes", "deep_minutes", "light_minutes", "rem_minutes", "awake_minutes",
  "nap_minutes", "skin_temp", "respiratory_rate", "body_fat",
];

const isNum = (v: any) => typeof v === "number" && Number.isFinite(v);

function timezoneOffsetMinutes(value: unknown): number {
  const match = String(value || "").match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function dayForTimestamp(timestamp: number, offset: number): string {
  const local = new Date(timestamp + offset * 60000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

function parsePointValue(value: unknown): any {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return Number(value); }
}

function numberFrom(value: any, ...keys: string[]): number | null {
  const candidate = value && typeof value === "object"
    ? keys.map((key) => value[key]).find((entry) => entry != null)
    : value;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

const DETAIL_ARRAY_FIELDS = [
  "_resting_points", "_spo2_points", "_hrv_points", "_skin_temp_points",
  "_weight_points", "_body_fat_points", "_sleep_segments",
];

function uniqueEntries(...lists: any[][]): any[] {
  const entries = new Map<string, any>();
  for (const list of lists) for (const entry of list || []) entries.set(JSON.stringify(entry), entry);
  return [...entries.values()];
}

function uniqueHeartRatePoints(...lists: number[][]): number[] {
  const points = new Map<string, [number, number]>();
  for (const list of lists) {
    for (let index = 0; index + 1 < (list || []).length; index += 2) {
      const point: [number, number] = [list[index], list[index + 1]];
      points.set(`${point[0]}|${point[1]}`, point);
    }
  }
  return [...points.values()].sort((a, b) => a[0] - b[0]).flat();
}

export function mergeHuaweiDays(previous: Record<string, any>, incoming: Record<string, any>) {
  const merged = { ...previous, ...incoming };
  merged._hr = uniqueHeartRatePoints(previous._hr || [], incoming._hr || []);
  for (const field of DETAIL_ARRAY_FIELDS) {
    merged[field] = uniqueEntries(previous[field] || [], incoming[field] || []);
  }
  if (previous._segs || incoming._segs) {
    merged._segs = uniqueEntries(previous._segs || [], incoming._segs || []);
  }
  if (previous._resting || incoming._resting) {
    merged._resting = uniqueEntries(previous._resting || [], incoming._resting || []);
  }
  return merged;
}

export function finalizeHealthDetailDay(day: Record<string, any>) {
  const result = { ...day };
  const average = (points: [number, number][], digits = 0) => {
    const values = points.map((point) => point[1]).filter(Number.isFinite);
    if (!values.length) return null;
    const scale = 10 ** digits;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * scale) / scale;
  };
  const latest = (points: [number, number][]) =>
    [...points].sort((a, b) => a[0] - b[0]).at(-1)?.[1] ?? null;

  if (result._resting_points?.length) {
    const values = result._resting_points.map((point: [number, number]) => point[1]).sort((a: number, b: number) => a - b);
    const middle = Math.floor(values.length / 2);
    result.resting_hr = Math.round(values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2);
  }
  if (result._spo2_points?.length) result.spo2 = average(result._spo2_points);
  if (result._hrv_points?.length) result.hrv = average(result._hrv_points);
  if (result._skin_temp_points?.length) result.skin_temp = average(result._skin_temp_points, 1);
  if (result._weight_points?.length) result.weight = Math.round(latest(result._weight_points) * 10) / 10;
  if (result._body_fat_points?.length) result.body_fat = Math.round(latest(result._body_fat_points) * 10) / 10;

  if (result._sleep_segments?.length) {
    result._segs = uniqueEntries(result._segs || [], result._sleep_segments);
    assignNightAndNaps(result);
    if (result._sleepFrom != null && result._sleepTo > result._sleepFrom) {
      result.sleep_start = toIso(result._sleepFrom);
      result.sleep_end = toIso(result._sleepTo);
    }
  }
  return result;
}

export function parseHealthDetailRecords(records: unknown): ParsedData | null {
  if (!Array.isArray(records)) return null;
  const days = new Map<string, any>();
  const seen = new Set<string>();
  const aliases: Record<string, string> = {
    DATA_POINT_DYNAMIC_HEARTRATE: "dynamic_hr",
    DYNAMIC_HEART_RATE: "dynamic_hr",
    DATA_POINT_NEW_REST_HEARTRATE: "resting_hr",
    RESTING_HEART_RATE: "resting_hr",
    WEIGHT_BODYFAT_BROAD: "weight_body_fat",
    BLOOD_OXYGEN_SATURATION: "spo2",
    HEART_RATE_VARIABILITY: "hrv",
    SKIN_TEMPERATURE: "skin_temp",
  };
  const sleepStages: Record<string, string> = {
    PROFESSIONAL_SLEEP_DREAM: "rem_minutes",
    PROFESSIONAL_SLEEP_SHALLOW: "light_minutes",
    PROFESSIONAL_SLEEP_DEEP: "deep_minutes",
    PROFESSIONAL_SLEEP_NOON: "light_minutes",
    PROFESSIONAL_SLEEP_WAKE: "awake_minutes",
  };
  const hasHuaweiRecords = records.some((record: any) => record && Array.isArray(record.samplePoints));
  if (!hasHuaweiRecords) return null;
  const getDay = (date: string) => {
    if (!days.has(date)) days.set(date, {
      date, _hr: [], _resting_points: [], _spo2_points: [], _hrv_points: [],
      _skin_temp_points: [], _weight_points: [], _body_fat_points: [], _sleep_segments: [],
    });
    return days.get(date);
  };

  for (const record of records) {
    if (!record || !Array.isArray(record.samplePoints)) continue;
    const offset = timezoneOffsetMinutes(record.timeZone);
    for (const point of record.samplePoints) {
      const key = String(point?.key || "");
      const metric = aliases[key];
      const sleepStage = sleepStages[key];
      if (!metric && !sleepStage) continue;
      const timestamp = Number(point.startTime ?? record.startTime);
      if (!Number.isFinite(timestamp)) continue;

      if (sleepStage) {
        const endTimestamp = Number(point.endTime ?? record.endTime);
        if (!Number.isFinite(endTimestamp) || endTimestamp <= timestamp) continue;
        const localStart = timestamp + offset * 60000;
        const localEnd = endTimestamp + offset * 60000;
        const from = Math.floor(localStart / 60000);
        const to = Math.max(from + 1, Math.ceil(localEnd / 60000));
        const startDate = dayForTimestamp(timestamp, offset);
        const startHour = new Date(localStart).getUTCHours();
        const date = startHour >= 18 ? nextDay(startDate) : startDate;
        const identity = `${sleepStage}|${from}|${to}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        getDay(date)._sleep_segments.push([from, to, sleepStage, to - from]);
        continue;
      }

      const value = parsePointValue(point.value);
      const date = dayForTimestamp(timestamp, offset);
      const day = getDay(date);
      const identity = `${metric}|${timestamp}|${JSON.stringify(value)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      if (metric === "dynamic_hr") {
        const bpm = numberFrom(value, "heartRate", "value");
        if (bpm != null && bpm >= 30 && bpm <= 220) day._hr.push(Math.floor((timestamp + offset * 60000) / 60000), bpm);
      } else if (metric === "resting_hr") {
        const bpm = numberFrom(value, "restingHeartRate", "heartRate", "value");
        if (bpm != null && bpm >= 30 && bpm <= 120) day._resting_points.push([timestamp, bpm]);
      } else if (metric === "weight_body_fat") {
        const weight = numberFrom(value, "bodyWeight", "weight");
        const bodyFat = numberFrom(value, "bodyFatRate", "bodyFat");
        if (weight != null && weight > 0 && weight <= 500) day._weight_points.push([timestamp, weight]);
        if (bodyFat != null && bodyFat > 0 && bodyFat <= 100) day._body_fat_points.push([timestamp, bodyFat]);
      } else if (metric === "spo2") {
        const saturation = numberFrom(value, "avgSaturation", "spo2", "oxygenSaturation");
        if (saturation != null && saturation >= 50 && saturation <= 100) day._spo2_points.push([timestamp, saturation]);
      } else if (metric === "hrv") {
        const hrv = numberFrom(value, "heartRateVariabilityRMSSD", "hrv");
        if (hrv != null && hrv > 5 && hrv < 300) day._hrv_points.push([timestamp, hrv]);
      } else if (metric === "skin_temp") {
        const temperature = numberFrom(value, "skinTemperature", "skinTemp");
        if (temperature != null && temperature >= 10 && temperature <= 45) day._skin_temp_points.push([timestamp, temperature]);
      }
    }
  }

  return { days: [...days.values()], workouts: [] };
}

export function parseHuaweiMotionPathRecords(records: unknown): Record<string, any>[] | null {
  if (!Array.isArray(records)) return null;
  const workouts: Record<string, any>[] = [];
  const seen = new Set<string>();
  let isMotionPathExport = false;

  for (const record of records) {
    if (!record || typeof record.summaryData !== "string") continue;
    let summary: any;
    try { summary = JSON.parse(record.summaryData); } catch { continue; }
    if (!summary || typeof summary !== "object" || summary.sportType == null) continue;
    isMotionPathExport = true;

    const start = Number(record.startTime);
    const end = Number(record.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const offset = timezoneOffsetMinutes(record.timeZone);
    const startLocal = new Date(start + offset * 60000);
    const durationMin = Math.round((end - start) / 60000);
    if (!(durationMin > 0) || durationMin > 1440) continue;

    const identity = `${start}|${end}|${summary.sportType}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const numeric = (value: unknown) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const heartRate = (value: unknown) => {
      const parsed = numeric(value);
      return parsed != null && parsed >= 30 && parsed <= 220 ? Math.round(parsed) : null;
    };
    const meters = numeric(summary.totalDistance);
    const calories = numeric(summary.totalCalories);

    workouts.push({
      date: dayForTimestamp(start, offset),
      start_time: `${pad(startLocal.getUTCHours())}:${pad(startLocal.getUTCMinutes())}`,
      activity: "Workout",
      sport_type: numeric(summary.sportType),
      duration_min: durationMin,
      calories: calories != null && calories > 0 ? Math.round(calories / 10) / 100 : null,
      avg_hr: heartRate(summary.avgHeartRate),
      max_hr: heartRate(summary.maxHeartRate),
      min_hr: heartRate(summary.minHeartRate),
      distance_km: meters != null && meters > 0 ? Math.round(meters / 10) / 100 : null,
      steps: numeric(summary.totalSteps),
      is_outdoor: summary.hasTrackPoint === true,
      source: "huawei_motion_path",
      method: "device_summary",
    });
  }

  return isMotionPathExport ? workouts : null;
}

// Accepts a full local timestamp, or a bare clock time which is anchored to `date`.
function asStamp(v: any, date: string) {
  const s = String(v || "");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${date}T${pad(Number(m[1]))}:${m[2]}` : null;
}

// The minutes a logged session occupied on its own date, in the same minute space as the
// day's heart-rate trace, so the day's zones can be read twice: whole, and with the
// session's own minutes removed (FIX 3 — each source counted exactly once).
export function sessionWindows(workouts: Record<string, any>[]) {
  const map = new Map<string, { from: number; to: number }[]>();
  for (const w of workouts) {
    const date = String(w?.date ?? "");
    const start = asStamp(w?.start_time, date);
    const minutes = Number(w?.duration_min);
    if (!start || !(minutes > 0)) continue;
    const from = epoch(start);
    const list = map.get(date) || [];
    list.push({ from, to: from + minutes });
    map.set(date, list);
  }
  return map;
}

// Turns the merged raw data for one day into a storable record.
//
// FIX 3 — resting HR comes from the sleep window only (the night that ended on this
// date), with implausible readings dropped, and is read off a percentile band.
// FIX 5 — the same trace becomes minutes in heart-rate zones.
export function finalizeDay(day: any, spans: { from: number; to: number }[] = []) {
  const o: any = { date: day.date };
  for (const k of DAY_FIELDS) if (isNum(day[k])) o[k] = day[k];

  const start = asStamp(day.sleep_start, day.date);
  const end = asStamp(day.sleep_end, day.date);
  if (start && end) {
    o.sleep_start = start;
    o.sleep_end = end;
  }
  const stageSum = (o.deep_minutes || 0) + (o.light_minutes || 0) + (o.rem_minutes || 0);
  if (!o.sleep_minutes && stageSum) o.sleep_minutes = stageSum;
  // Naps stay off sleep_minutes, which is the night's duration and nothing else.
  if (Array.isArray(day.nap_windows) && day.nap_windows.length) o.nap_windows = day.nap_windows;

  // A date left holding nothing but a stray trace is not a day worth scoring.
  const keep = () => (Object.keys(o).length > 1 ? o : null);

  const pts = packPoints(day._hr);
  if (!pts) return keep();

  const dayStart = epoch(`${o.date}T00:00`);
  const plausible = (v: number) => v > HR_MIN && v <= HR_MAX;

  // Overnight pool first; a day whose sleep file is missing falls back to the whole day.
  let pool = start && end ? slicePoints(pts, epoch(start), epoch(end)).map((p) => p[1]).filter(plausible) : [];
  if (pool.length < MIN_POOL) pool = slicePoints(pts, dayStart, dayStart + 1440).map((p) => p[1]).filter(plausible);
  if (pool.length) o.resting_hr = Math.round(band(pool, 0.02, 0.08));

  const dayPts = slicePoints(pts, dayStart, dayStart + 1440);
  if (o.resting_hr && dayPts.length >= 2) {
    const zones = [0, 0, 0, 0, 0];
    // FIX 3 — the same trace with the minutes a logged session covered left out; the
    // scorer adds that session's own strain in their place, so nothing counts twice.
    const own = [0, 0, 0, 0, 0];
    const inSession = (t: number) => spans.some((s) => t >= s.from && t < s.to);
    let span = 0;
    let prev: number | null = null;
    let prevZone = -1;
    for (const [t, v] of dayPts) {
      if (prev != null) {
        const dt = Math.min(GAP_CAP, t - prev);
        if (dt > 0) {
          span += dt;
          if (prevZone >= 0) {
            zones[prevZone] += dt;
            if (!inSession(prev)) own[prevZone] += dt;
          }
        }
      }
      prev = t;
      prevZone = zoneForHr(v, o.resting_hr);
    }
    // Only claim heart-rate coverage when enough of the day is actually worn;
    // otherwise the scorer falls back to steps and logged sessions.
    if (span >= COVER_SPAN && dayPts.length >= COVER_COUNT) {
      o.zone_minutes = zones.map((m) => Math.round(m));
      o.zone_minutes_residual = own.map((m) => Math.round(m));
      o.hr_covered = true;
    }
  }
  return keep();
}

// Chooses the night from a day's stage segments: the longest unbroken cluster by staged
// minutes wins. Any other cluster that day is a nap — recorded on the day, but excluded
// from the night's duration and from the bed/wake times the consistency score reads.
function assignNightAndNaps(d: any) {
  const segs: any[] = [...d._segs].sort((a, b) => a[0] - b[0]);
  const clusters: any[][][] = [];
  for (const s of segs) {
    const cur = clusters[clusters.length - 1];
    if (cur && s[0] - cur[cur.length - 1][1] <= NAP_GAP_MIN) cur.push(s);
    else clusters.push([s]);
  }
  const total = (c: any[][]) => c.reduce((s, seg) => s + seg[3], 0);
  const night = clusters.reduce((a, b) => (total(b) > total(a) ? b : a), clusters[0]);
  for (const seg of night) d[seg[2]] = (d[seg[2]] || 0) + seg[3];
  d._sleepFrom = night[0][0];
  d._sleepTo = Math.max(...night.map((seg) => seg[1]));

  const naps = clusters.filter((c) => c !== night);
  if (naps.length) {
    d.nap_minutes = naps.reduce((s, c) => s + total(c), 0);
    d.nap_windows = naps.map(
      (c) => `${toClock(Math.min(...c.map((seg) => seg[0])))}-${toClock(Math.max(...c.map((seg) => seg[1])))}`,
    );
  }
}

// Aggregates a raw Huawei Health metric CSV into one record per day.
export function parseMetricsCsv(text: string): ParsedData | null {
  const { headers, rows } = parseCsv(text);
  if (!headers.length || !rows.length) return null;
  const nh = headers.map(normHeader);
  const col = (...keys: string[]) => {
    for (let i = 0; i < nh.length; i++) if (keys.some((k) => nh[i].includes(k))) return i;
    return -1;
  };
  const dateI = col("date", "datetimestamp");
  const hrI = col("heartrate");
  const spo2I = col("oxygensaturation", "bloodoxygen", "spo2");
  const stepsI = col("steps");
  const weightI = col("weight");
  const stageI = col("sleepstage", "stage");
  const durI = col("durationinseconds", "duration");
  const endI = col("endtime", "endtimestamp", "enddate", "wakeuptime");
  if (dateI < 0 || (hrI < 0 && spo2I < 0 && stepsI < 0 && weightI < 0 && stageI < 0)) return null;

  const days = new Map<string, any>();
  const get = (date: string) => {
    if (!days.has(date)) days.set(date, { date, _spo2: [] as number[], _steps: 0, _weight: [] as number[], _hr: [] as number[], _segs: [] as any[] });
    return days.get(date);
  };
  // Evening readings are also handed to the next day, whose overnight window starts
  // before midnight. Held aside so the extra copy can't invent a day of its own.
  const evening = new Map<string, number[]>();

  for (const r of rows) {
    const ts = stamp(r[dateI]);
    if (!ts) continue;
    const n = (i: number) => (i >= 0 ? parseFloat(r[i]) : NaN);

    if (hrI >= 0) {
      const v = n(hrI);
      if (v > 0) {
        get(ts.date)._hr.push(ts.minutes, v);
        if (ts.hour >= 18) {
          const next = nextDay(ts.date);
          if (!evening.has(next)) evening.set(next, []);
          evening.get(next)!.push(ts.minutes, v);
        }
      }
    }

    // A row is a sleep segment only when its stage cell actually names a stage —
    // otherwise an evening steps or SpO2 row would be credited to the next day.
    const stageKey = stageI >= 0 ? STAGES[normHeader(r[stageI])] : null;
    const sleepRow = !!stageKey && durI >= 0;
    // A sleep session starting in the evening belongs to the following day.
    const d = get(sleepRow && ts.hour >= 18 ? nextDay(ts.date) : ts.date);

    if (spo2I >= 0) { const v = n(spo2I); if (v > 0) d._spo2.push(v); }
    if (stepsI >= 0) { const v = n(stepsI); if (v > 0) d._steps += v; }
    if (weightI >= 0) { const v = n(weightI); if (v > 0) d._weight.push(v); }

    if (sleepRow) {
      const mins = Math.round(n(durI) / 60);
      if (mins > 0) {
        // End time when the export states it with a clock time, otherwise start
        // plus the segment's own duration. Segments are kept whole and unstaged into
        // the record later: only then are the day's clusters known.
        const stated = endI >= 0 && /[ T]\d{2}:\d{2}/.test(String(r[endI])) ? stamp(r[endI]) : null;
        d._segs.push([ts.minutes, stated ? stated.minutes : ts.minutes + mins, stageKey, mins]);
      }
    }
  }

  for (const [date, pts] of evening) {
    const d = days.get(date);
    if (d) d._hr.push(...pts);
  }

  for (const d of days.values()) if (d._segs.length) assignNightAndNaps(d);

  const out: any[] = [];
  for (const d of days.values()) {
    const o: any = { date: d.date };
    if (d._spo2.length) o.spo2 = Math.round(d._spo2.reduce((a: number, b: number) => a + b, 0) / d._spo2.length);
    if (d._steps) o.steps = Math.round(d._steps);
    if (d._weight.length) o.weight = Math.round(d._weight[d._weight.length - 1] * 10) / 10;
    if (d._sleepFrom != null && d._sleepTo != null && d._sleepTo > d._sleepFrom) {
      o.sleep_start = toIso(d._sleepFrom);
      o.sleep_end = toIso(d._sleepTo);
    }
    if (d.awake_minutes) o.awake_minutes = d.awake_minutes;
    if (d.nap_minutes) o.nap_minutes = d.nap_minutes;
    if (d.nap_windows && d.nap_windows.length) o.nap_windows = d.nap_windows;
    if (d.deep_minutes) o.deep_minutes = d.deep_minutes;
    if (d.light_minutes) o.light_minutes = d.light_minutes;
    if (d.rem_minutes) o.rem_minutes = d.rem_minutes;
    if (d._hr.length) o._hr = d._hr;
    out.push(o);
  }
  return { days: out, workouts: [] };
}
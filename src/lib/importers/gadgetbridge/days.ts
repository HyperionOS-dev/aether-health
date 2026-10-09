// Daily records from a Gadgetbridge dump.
//
// Every timestamp in the dump is UTC while the health data it describes is local, so
// each reading is converted to the local wall clock for the import's own timezone
// before it is filed under a day. Getting that wrong shifts a whole night onto the
// wrong date, which is why the zone is a per-import setting and never a constant.
//
// Sleep follows the same policy as the CSV path: stage rows are clustered, a gap wider
// than 90 minutes starts a new session, the longest cluster is the night (duration, bed
// and wake times), every other cluster is a nap. Stage code 5 is unmapped and stays out
// of the night's duration entirely — it is counted only as unknown minutes.

import { zoneForHr } from "@/lib/scoring/scores";
import { col, localClock, localDate, localIso, localMinutes, metric, saneHeartRate, tableOf } from "./tables.ts";

const SOURCE = "gadgetbridge_import";
const NAP_GAP_MIN = 90; // wider than this separates a nap from the night
const GAP_CAP_MIN = 5; // a wider gap carries no zone credit
const COVER_SPAN_MIN = 360; // estimated wear needed before the day's trace is trusted
const COVER_MIN_READINGS = 60;
const MIN_POOL = 10; // readings needed before the fallback resting-HR band is used
const STAGE_FIELDS: Record<string, string> = { "1": "light_minutes", "2": "rem_minutes", "3": "deep_minutes", "4": "awake_minutes" };
const UNKNOWN_STAGE = "5";

type Session = { from: number; to: number; minutes: Record<string, number> };

const round1 = (v: number) => Math.round(v * 10) / 10;

// Mean of the values between two percentile positions: steadier than one percentile
// value, far less exposed to a few artifacts than the mean of a bottom bucket.
function band(values: number[], lo: number, hi: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const from = Math.min(sorted.length - 1, Math.floor(sorted.length * lo));
  const to = Math.max(from, Math.min(sorted.length - 1, Math.round(sorted.length * hi) - 1));
  let sum = 0;
  for (let i = from; i <= to; i++) sum += sorted[i];
  return Math.round(sum / (to - from + 1));
}

// Standard median: with an even count the two middle samples are averaged, so one
// higher reading cannot stand in for the day's resting value.
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};

export function buildDays(
  tables: Record<string, string>,
  timezone: string,
  fallbackOffset: number,
  sessionSpans: Map<string, { from: number; to: number }[]> = new Map(),
): Record<string, any>[] {
  const days = new Map<string, Record<string, any>>();
  const get = (date: string) => {
    if (!days.has(date)) days.set(date, { date, sources: {} });
    return days.get(date)!;
  };

  // --- per-sample activity: heart rate, steps, calories, SpO2, the watch's own resting HR
  const act = tableOf(tables, "HUAWEI_ACTIVITY_SAMPLE");
  if (act) {
    const iTs = col(act.headers, "timestamp");
    const iHr = col(act.headers, "heartrate");
    const iSteps = col(act.headers, "steps");
    const iCal = col(act.headers, "calories");
    const iSpo = col(act.headers, "spo");
    const iRhr = col(act.headers, "restingheartrate");
    for (const row of act.rows) {
      const ms = Date.parse(row[iTs] ?? "");
      if (!Number.isFinite(ms)) continue;
      const local = localMinutes(ms, timezone, fallbackOffset);
      const day = get(localDate(local));

      const hr = saneHeartRate(Number(row[iHr]));
      if (hr != null) (day._hr ||= []).push([local, hr]);

      const steps = metric(row, iSteps);
      if (steps != null && steps > 0) day._steps = (day._steps || 0) + steps;

      // Calories arrive in hundredths of a kilocalorie: a day of samples sums to about
      // 190,000 before scaling, and that same day's own sessions report plain kcal.
      const cal = metric(row, iCal);
      if (cal != null && cal > 0) day._cal = (day._cal || 0) + cal / 100;

      const spo = metric(row, iSpo);
      if (spo != null && spo >= 50 && spo <= 100) (day._spo ||= []).push(spo);

      const rhr = metric(row, iRhr);
      if (rhr != null && rhr >= 30 && rhr <= 120) (day._deviceRhr ||= []).push(rhr);
    }
  }

  // --- sleep stages: one row per minute, clustered into the night and any naps
  const stage = tableOf(tables, "HUAWEI_SLEEP_STAGE_SAMPLE");
  if (stage) {
    const iTs = col(stage.headers, "timestamp");
    const iStage = col(stage.headers, "stage");
    const rows: { t: number; code: string }[] = [];
    for (const row of stage.rows) {
      const ms = Date.parse(row[iTs] ?? "");
      const code = String(row[iStage] ?? "").trim();
      if (!Number.isFinite(ms) || !code) continue;
      rows.push({ t: localMinutes(ms, timezone, fallbackOffset), code });
    }
    rows.sort((a, b) => a.t - b.t);

    const sessions: Session[] = [];
    for (const r of rows) {
      const cur = sessions[sessions.length - 1];
      if (cur && r.t - cur.to <= NAP_GAP_MIN) {
        cur.to = r.t;
        cur.minutes[r.code] = (cur.minutes[r.code] || 0) + 1;
      } else {
        sessions.push({ from: r.t, to: r.t, minutes: { [r.code]: 1 } });
      }
    }
    const total = (s: Session) => Object.values(s.minutes).reduce((a, b) => a + b, 0);

    const byDate = new Map<string, Session[]>();
    for (const s of sessions) {
      const date = localDate(s.to); // a night belongs to the day it ended on
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(s);
    }

    for (const [date, list] of byDate) {
      const day = get(date);
      // The largest cluster is the night. Unknown minutes compete for that title but are
      // never written into a real stage.
      const night = list.reduce((a, b) => (total(b) > total(a) ? b : a), list[0]);
      for (const [code, mins] of Object.entries(night.minutes)) {
        const field = STAGE_FIELDS[code];
        if (field) day[field] = (day[field] || 0) + mins;
        else if (code === UNKNOWN_STAGE) day.sleep_unknown_minutes = (day.sleep_unknown_minutes || 0) + mins;
      }
      day.sleep_start = localIso(night.from);
      day.sleep_end = localIso(night.to);
      day.sources.sleep = "stage_rows";

      const naps = list.filter((s) => s !== night);
      if (naps.length) {
        day.nap_minutes = naps.reduce((s, c) => s + total(c), 0);
        day.nap_windows = naps.map((c) => `${localClock(c.from)}-${localClock(c.to)}`);
      }
    }
  }

  // --- per-night summary: HRV and blood oxygen, held by the night's own end date
  const stats = tableOf(tables, "HUAWEI_SLEEP_STATS_SAMPLE");
  if (stats) {
    const iRise = col(stats.headers, "risingtime");
    const iHrv = col(stats.headers, "avghrv");
    const iO2 = col(stats.headers, "avgoxygensaturation");
    const iAvgHr = col(stats.headers, "avgheartrate");
    for (const row of stats.rows) {
      const ms = Date.parse(row[iRise] ?? "");
      if (!Number.isFinite(ms)) continue;
      const day = get(localDate(localMinutes(ms, timezone, fallbackOffset)));

      const hrv = metric(row, iHrv);
      if (hrv != null && hrv > 5 && hrv < 300 && day.hrv == null) {
        day.hrv = Math.round(hrv);
        day.sources.hrv = "sleep_stats";
      }
      const o2 = metric(row, iO2);
      if (o2 != null && o2 >= 50 && o2 <= 100 && day.spo2 == null) {
        day.spo2 = Math.round(o2);
        day.sources.spo2 = "sleep_stats";
      }
      const avgHr = metric(row, iAvgHr);
      if (avgHr != null && avgHr >= 30 && avgHr <= 220) day._sleepAvgHr = avgHr;
    }
  }

  // --- skin temperature
  const temp = tableOf(tables, "HUAWEI_TEMPERATURE_SAMPLE");
  if (temp) {
    const iTs = col(temp.headers, "timestamp");
    const iVal = col(temp.headers, "temperature");
    const iType = col(temp.headers, "temperaturetype");
    for (const row of temp.rows) {
      const ms = Date.parse(row[iTs] ?? "");
      if (!Number.isFinite(ms)) continue;
      const type = metric(row, iType);
      if (type != null && type !== 2) continue; // 2 is the skin reading
      const v = metric(row, iVal);
      if (v == null || v < 20 || v > 45) continue;
      const day = get(localDate(localMinutes(ms, timezone, fallbackOffset)));
      (day._temp ||= []).push(v);
    }
  }

  // --- finalize each day: resting heart rate, zones, and the rest of the scalars
  const out: Record<string, any>[] = [];
  for (const day of days.values()) {
    const points = (day._hr || []) as [number, number][];

    // Resting heart rate, best source first: the watch's own resting value for the day,
    // then the same bottom-band derivation the CSV path uses, then the night's average.
    // Measured on one shared day: device 58, trace band 56, night average 62 — the night
    // average is a sleep-window mean, not a resting floor, so it is the last resort and
    // whichever source was used is recorded on the record.
    if (day._deviceRhr?.length) {
      day.resting_hr = median(day._deviceRhr);
      day.sources.resting_hr = "device_resting_hr";
    } else if (points.length >= MIN_POOL) {
      const plausible = points.map(([, v]) => v).filter((v) => v > 30 && v <= 120);
      if (plausible.length >= MIN_POOL) {
        day.resting_hr = band(plausible, 0.02, 0.08);
        day.sources.resting_hr = "hr_trace";
      }
    }
    if (day.resting_hr == null && day._sleepAvgHr != null) {
      day.resting_hr = Math.round(day._sleepAvgHr);
      day.sources.resting_hr = "sleep_stats_avg";
    }

    if (day.resting_hr != null && points.length) {
      let span = 0;
      let prev: number | null = null;
      let prevZone = -1;
      const zones = [0, 0, 0, 0, 0];
      // FIX 3 — the same trace with every minute a session covered left out. The day
      // total adds each session's own strain instead, so those minutes count exactly
      // once: the residual contributes the load the sessions did not account for.
      const own = [0, 0, 0, 0, 0];
      const spans = sessionSpans.get(day.date) || [];
      const inSession = (t: number) => spans.some((s) => t >= s.from && t < s.to);
      for (const [t, v] of points) {
        if (prev != null) {
          const dt = Math.min(GAP_CAP_MIN, t - prev);
          if (dt > 0) {
            span += dt;
            if (prevZone >= 0) {
              zones[prevZone] += dt;
              if (!inSession(prev)) own[prevZone] += dt;
            }
          }
        }
        prev = t;
        prevZone = zoneForHr(v, day.resting_hr);
      }
      // Only claim heart-rate coverage when enough of the day is actually worn, so the
      // scorer falls back to steps and logged sessions otherwise.
      if (span >= COVER_SPAN_MIN && points.length >= COVER_MIN_READINGS) {
        day.zone_minutes = zones.map((m) => Math.round(m));
        day.zone_minutes_residual = own.map((m) => Math.round(m));
        day.hr_covered = true;
        day.sources.zone_minutes = "activity_sample_trace";
        day.sources.zone_minutes_residual = "trace_ex_sessions";
      }
    }

    if (day._steps) {
      day.steps = Math.round(day._steps);
      day.sources.steps = "activity_samples";
    }
    if (day._cal) {
      day.calories = Math.round(day._cal);
      day.sources.calories = "activity_samples";
    }
    if (day._spo?.length) {
      day.spo2 = Math.round(day._spo.reduce((a: number, b: number) => a + b, 0) / day._spo.length);
      day.sources.spo2 = "activity_samples";
    }
    if (day._temp?.length) {
      day.skin_temp = round1(day._temp.reduce((a: number, b: number) => a + b, 0) / day._temp.length);
      day.sources.skin_temp = "temperature_samples";
    }

    // The night's duration is its staged sleep only — naps and unknown minutes stay out.
    const staged = (day.deep_minutes || 0) + (day.light_minutes || 0) + (day.rem_minutes || 0);
    if (staged) day.sleep_minutes = staged;

    day.source = SOURCE;
    for (const k of Object.keys(day)) if (k.startsWith("_")) delete day[k];
    out.push(day);
  }

  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
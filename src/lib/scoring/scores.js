// Health scoring model; every tunable constant lives in config.js.
import { SCORING_CONFIG } from "./config.js";

export const ALGO_VERSION = SCORING_CONFIG.algorithmVersion;
export const MAX_HR = SCORING_CONFIG.strain.maxHr;
export const ZONE_EDGES = SCORING_CONFIG.strain.zoneEdges;
const ZONE_MULT = SCORING_CONFIG.strain.zoneMultipliers;
const LOAD_DIVISOR = SCORING_CONFIG.strain.loadDivisor;
const DEFAULT_RHR = SCORING_CONFIG.strain.defaultRhr;
// Naps pay down sleep need before the night is measured against it; untuned guess, see config.js.
const NAP_NEED_CREDIT = SCORING_CONFIG.sleep.napNeedCredit; // untuned guess
const NAP_NEED_FLOOR = SCORING_CONFIG.sleep.napNeedFloor;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
const median = (values) => quantile(values, 0.5);
const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * clamp(p, 0, 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};

const strainFromLoad = (load) => r1(21 * (1 - Math.exp(-Math.max(0, load) / LOAD_DIVISOR)));
const loadFromStrain = (strain) => (strain >= 21 ? 0 : -LOAD_DIVISOR * Math.log(1 - strain / 21));
const reserve = (rhr) => Math.max(60, MAX_HR - rhr);

export function zoneForHr(hr, rhr) {
  if (!isNum(hr) || !isNum(rhr)) return -1;
  const hrr = (hr - rhr) / reserve(rhr);
  for (let z = ZONE_EDGES.length - 1; z >= 0; z--) if (hrr >= ZONE_EDGES[z]) return z;
  return -1;
}

export function zoneLoad(zoneMinutes) {
  return (zoneMinutes || []).reduce((s, m, i) => s + (m || 0) * ZONE_MULT[i], 0);
}

export function strainFromZones(zoneMinutes) {
  return strainFromLoad(zoneLoad(zoneMinutes));
}

function workoutLoad(w, rhr) {
  const hr = w.avg_hr || rhr + 40;
  const intensity = clamp((hr - rhr) / reserve(rhr), 0.05, 1);
  return (w.duration_min || 0) * intensity * intensity * 3;
}

function manualLoad(w) {
  if (isNum(w.strain)) return loadFromStrain(w.strain);
  return (w.duration_min || 0) * 0.75;
}

export function workoutStrain(w, rhr) {
  return strainFromLoad(workoutLoad(w, rhr || DEFAULT_RHR));
}

export function strainFromMet(minutes, met) {
  const intensity = clamp(met / 12, 0.2, 1);
  return strainFromLoad(minutes * intensity * intensity * 3);
}

function sessionLoad(w, rhr) {
  if (isNum(w.strain)) return loadFromStrain(w.strain);
  return isNum(w.avg_hr) ? workoutLoad(w, rhr) : manualLoad(w);
}

function dayStrain(d, workouts, rhr) {
  const zones = Array.isArray(d.zone_minutes) ? d.zone_minutes : null;
  const trace = Array.isArray(d.zone_minutes_residual) ? d.zone_minutes_residual : zones;
  const covered = d.hr_covered === true && !!trace && trace.some((m) => m > 0);
  const sessions = workouts.reduce((s, w) => s + sessionLoad(w, rhr), 0);
  if (covered) return strainFromLoad(zoneLoad(trace) + sessions);
  return strainFromLoad(sessions + (d.steps || 0) / 500);
}

export function baselineV5AsOf(history, date) {
  const config = SCORING_CONFIG.recoveryV5;
  const window = history.filter((day) => day.date < date).slice(-config.baselineWindow);
  const hrvValues = window.map((day) => day.hrv).filter((value) => isNum(value) && value > config.minHrv && value < config.maxHrv);
  const rhrValues = window.map((day) => day.resting_hr).filter((value) => isNum(value) && value >= config.minRhr && value <= config.maxRhr);
  const hrv = hrvValues.length ? mean(hrvValues) : config.defaultHrv;
  const rhr = rhrValues.length ? mean(rhrValues) : config.defaultRhr;
  const hrvSdPersonal = hrvValues.length > 1 ? sd(hrvValues) : 0;
  const rhrSdPersonal = rhrValues.length > 1 ? sd(rhrValues) : 0;
  const shrink = (n, personal, prior) => (n * personal + config.shrinkageK * prior) / (n + config.shrinkageK);
  const hrvSd = shrink(hrvValues.length, hrvSdPersonal, hrv * config.hrvPriorSdFraction);
  const rhrSd = Math.max(config.minRhrSd, shrink(rhrValues.length, rhrSdPersonal, config.rhrPriorSd));
  return {
    hrv: r1(hrv), hrvSd: r1(hrvSd), hrvN: hrvValues.length,
    rhr: r1(rhr), rhrSd: r1(rhrSd), rhrN: rhrValues.length,
  };
}

function recoveryCompositeV5(hrv, rhr, sleepPerformance, base) {
  const config = SCORING_CONFIG.recoveryV5;
  /** @type {[string, number, number][]} */
  const terms = [];
  if (isNum(hrv) && hrv > config.minHrv && hrv < config.maxHrv) {
    terms.push(["hrv", config.weights.hrv, clamp((hrv - base.hrv) / base.hrvSd, -config.zLimit, config.zLimit)]);
  }
  if (isNum(rhr) && rhr >= config.minRhr && rhr <= config.maxRhr) {
    terms.push(["rhr", config.weights.rhr, -clamp((rhr - base.rhr) / base.rhrSd, -config.zLimit, config.zLimit)]);
  }
  if (isNum(sleepPerformance)) {
    terms.push(["sleep", config.weights.sleep, clamp((sleepPerformance - config.sleepNeutral) / config.sleepRange, -config.zLimit, config.zLimit)]);
  }
  if (!terms.length) return { score: null, zc: null, hrvZ: null, rhrZ: null, sleepZ: null };
  const denominator = Math.sqrt(terms.reduce((sum, [, weight]) => sum + weight * weight, 0));
  const zc = terms.reduce((sum, [, weight, term]) => sum + weight * term, 0) / denominator;
  return {
    zc,
    hrvZ: terms.find(([key]) => key === "hrv")?.[2] ?? null,
    rhrZ: terms.find(([key]) => key === "rhr")?.[2] ?? null,
    sleepZ: terms.find(([key]) => key === "sleep")?.[2] ?? null,
  };
}

function workoutRecoveryMinutes(workout) {
  const config = SCORING_CONFIG.recoveryV6;
  if (isNum(workout.recovery_time_min) && workout.recovery_time_min > 0) return workout.recovery_time_min;
  const load = isNum(workout.workout_load) && workout.workout_load > 0
    ? workout.workout_load
    : isNum(workout.strain) ? loadFromStrain(workout.strain) : 0;
  return load > 0 ? load * config.fallbackMinutesPerLoadPoint : 0;
}

function workoutEnd(workout) {
  if (typeof workout.ended_at === "string") {
    const timestamp = Date.parse(workout.ended_at);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const time = String(workout.end_time || "");
  const dateTime = time.includes("T") ? time : `${workout.date}T${time || workout.start_time || "00:00"}`;
  const timestamp = Date.parse(dateTime);
  if (Number.isFinite(timestamp)) return timestamp + (isNum(workout.duration_min) && !time ? workout.duration_min * 60000 : 0);
  return NaN;
}

export function workoutDebtAt(workouts, at, personalSpeed = SCORING_CONFIG.recoveryV6.personalSpeedDefault) {
  const config = SCORING_CONFIG.recoveryV6;
  const sessions = [];
  let debt = 0;
  for (const workout of workouts) {
    const end = workoutEnd(workout);
    const recoveryMinutes = workoutRecoveryMinutes(workout);
    if (!Number.isFinite(end) || end > at || recoveryMinutes <= 0) continue;
    const debtPoints = Math.min(config.maxDebtPerWorkout, config.debtPointsPerHour * recoveryMinutes / 60);
    const remaining = debtPoints * Math.max(0, 1 - (at - end) / (recoveryMinutes * personalSpeed * 60000));
    if (remaining > 0) {
      debt += remaining;
      sessions.push({
        activity: workout.activity || "Workout",
        end_time: workout.ended_at || `${workout.date}T${workout.end_time || workout.start_time || "00:00"}`,
        debt: r1(remaining),
      });
    }
  }
  return { debt: Math.min(config.maxWorkoutDebt, debt), sessions };
}

export function recoveryAtTime(workouts, zc, at, personalSpeed = SCORING_CONFIG.recoveryV6.personalSpeedDefault, lastStrainAt = null) {
  const config = SCORING_CONFIG.recoveryV6;
  const time = at instanceof Date ? at.getTime() : Number(at);
  const debtNow = workoutDebtAt(workouts, time, personalSpeed);
  const physioPenalty = Math.min(config.maxPhysioPenalty, config.physioPenaltyPerNegativeZ * Math.max(0, -(isNum(zc) ? zc : 0)));
  const calculate = (hours) => {
    const debt = workoutDebtAt(workouts, time + hours * 3600000, personalSpeed).debt;
    const physiology = physioPenalty * Math.exp(-hours / config.physioDecayHours);
    return clamp(100 - debt - physiology, config.recoveryMin, config.recoveryMax);
  };
  const recovery = Math.round(calculate(0));
  let timeToFull = null;
  for (let hours = config.simulationStepHours; hours <= config.simulationMaxHours; hours += config.simulationStepHours) {
    if (calculate(hours) >= config.fullyRecoveredAt) { timeToFull = hours; break; }
  }
  const recentStrain = isNum(lastStrainAt) && lastStrainAt <= time && time - lastStrainAt <= config.stillAccruingMinutes * 60000;
  const stillAccruing = recentStrain || debtNow.sessions.some((session) => {
    const end = Date.parse(session.end_time);
    return Number.isFinite(end) && end > time - config.stillAccruingMinutes * 60000;
  });
  return {
    recovery,
    recovery_evaluated_at: new Date(time).toISOString(),
    workout_debt: r1(debtNow.debt),
    physio_penalty: r1(physioPenalty),
    recovery_sessions: debtNow.sessions,
    time_to_full_hours: recovery >= config.fullyRecoveredAt ? 0 : timeToFull,
    recovery_status: stillAccruing ? "still accruing" : recovery >= config.fullyRecoveredAt ? "Fully recovered" : timeToFull == null ? "Over 72h to full" : `${timeToFull}h to full`,
    recovery_still_accruing: stillAccruing,
  };
}

export function localDateTimeToEpoch(value, timezone) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second = "0"] = match;
  let utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (!timezone) return utc;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utc)).map(({ type, value }) => [type, value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    utc -= represented - utc;
  }
  return utc;
}

function localSnapshotTime(date, timezone, hour = SCORING_CONFIG.recoveryV6.snapshotHour) {
  return localDateTimeToEpoch(`${date}T${String(hour).padStart(2, "0")}:00:00`, timezone);
}

function dateInTimezone(time, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(time).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function personalRecoverySpeed(prepared, workouts) {
  const config = SCORING_CONFIG.recoveryV6;
  const zByDate = new Map(prepared.filter((entry) => isNum(entry.composite.zc)).map((entry) => [entry.day.date, entry.composite.zc]));
  const latest = prepared.at(-1)?.day.date;
  const earliest = latest ? new Date(`${latest}T00:00:00Z`) : null;
  if (earliest) earliest.setUTCDate(earliest.getUTCDate() - config.personalWindowDays + 1);
  const startDate = earliest?.toISOString().slice(0, 10);
  const recentWorkouts = workouts.filter((workout) => workout.date >= startDate && workout.date <= latest);
  const workoutDates = new Set(recentWorkouts.map((workout) => workout.date));
  const workoutEffects = [];
  const restEffects = [];
  for (const entry of prepared) {
    const previousDate = new Date(`${entry.day.date}T00:00:00Z`);
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    const previous = previousDate.toISOString().slice(0, 10);
    const effect = -zByDate.get(entry.day.date);
    if (!Number.isFinite(effect)) continue;
    if (workoutDates.has(previous)) workoutEffects.push(effect);
    else if (zByDate.has(previous)) restEffects.push(effect);
  }
  const n = workoutDates.size;
  if (n < config.personalSpeedMinWorkoutDays || !workoutEffects.length || !restEffects.length) {
    return { value: config.personalSpeedDefault, workoutDays: n, label: n >= config.personalizedAtWorkoutDays ? "Personalized" : "Using your watch's estimate" };
  }
  const shrink = n / (n + config.personalSpeedShrinkN);
  const difference = mean(workoutEffects) - mean(restEffects);
  const value = clamp(1 + config.personalSpeedImpact * difference * shrink, config.personalSpeedMin, config.personalSpeedMax);
  return { value: r2(value), workoutDays: n, label: n >= config.personalizedAtWorkoutDays ? "Personalized" : "Using your watch's estimate" };
}

function anchorMinutes(ts) {
  const m = String(ts || "").match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  return (h < 12 ? h + 12 : h - 12) * 60 + Number(m[2]);
}

export function sleepConsistency(nights) {
  const config = SCORING_CONFIG.sleep;
  const bed = nights.map((d) => anchorMinutes(d.sleep_start)).filter(isNum);
  const wake = nights.map((d) => anchorMinutes(d.sleep_end)).filter(isNum);
  if (bed.length < 2 || wake.length < 2) return null;
  return Math.round(clamp(100 - config.consistencyK * (sd(bed) + sd(wake)), 0, 100));
}

export function durationVariability(nights) {
  const config = SCORING_CONFIG.sleep;
  const hours = nights.map((d) => d.sleep_hours).filter(isNum);
  if (hours.length < 2) return null;
  return Math.round(sd(hours) * 60);
}

const nextDate = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// Minutes of nap credit owed to each filed day's night. A nap is taken on the day
// BEFORE the night it shortens, so the credit rides with that night: a nap the importers
// filed on the day it happened (window starting before their 18:00 evening cut) belongs
// to the following night, while one they filed together with the night it precedes
// (window starting at/after the cut — parse.ts:294, parse.ts:628) already sits there.
// Every nap minute lands on exactly one night, and naps filed on one day add into a
// single credit, so nothing is dropped twice or counted twice.
function napCreditByNight(days) {
  const EVENING_CUT_HOUR = 18;
  const credits = new Map();
  const add = (date, minutes) => credits.set(date, (credits.get(date) || 0) + minutes);
  const filed = new Set(days.map((d) => d.date));
  for (const day of days) {
    const total = isNum(day.nap_minutes) && day.nap_minutes > 0 ? day.nap_minutes : 0;
    if (!total) continue;
    const windows = (Array.isArray(day.nap_windows) ? day.nap_windows : []).flatMap((window) => {
      const match = String(window).match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!match) return [];
      const from = Number(match[1]) * 60 + Number(match[2]);
      const to = Number(match[3]) * 60 + Number(match[4]);
      const minutes = to === from ? 0 : (to > from ? to : to + 1440) - from; // a nap over midnight
      return [{ startHour: Math.floor(from / 60), minutes }];
    }).filter((window) => window.minutes > 0);
    // No readable window: leave the day's naps on its own night, as before.
    if (!windows.length) { add(day.date, total); continue; }
    const later = windows.filter((window) => window.startHour >= EVENING_CUT_HOUR);
    const earlier = windows.filter((window) => window.startHour < EVENING_CUT_HOUR);
    const length = (list) => list.reduce((sum, window) => sum + window.minutes, 0);
    // A day whose naps straddle the cut is split by each nap's own length.
    const stays = later.length ? Math.round((total * length(later)) / (length(later) + length(earlier))) : 0;
    if (stays) add(day.date, stays);
    if (total - stays) add(nextDate(day.date), total - stays);
  }
  for (const date of [...credits.keys()]) if (!filed.has(date)) credits.delete(date); // no imported night to credit
  return credits;
}

export function computeScores(days, workouts, targets) {
  const ordered = [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const napCredits = napCreditByNight(ordered);
  const byDate = new Map();
  for (const w of workouts) {
    if (!byDate.has(w.date)) byDate.set(w.date, []);
    byDate.get(w.date).push(w);
  }

  const strain = new Map();
  for (const d of ordered) {
    strain.set(d.date, dayStrain(d, byDate.get(d.date) || [], d.resting_hr || DEFAULT_RHR));
  }

  const wanted = new Set(targets);
  const out = new Map();
  const latestDate = ordered.at(-1)?.date;
  const v5Config = SCORING_CONFIG.recoveryV5;
  const prepared = [];
  for (let i = 0; i < ordered.length; i++) {
    const d = ordered[i];
    const priorStrain = i > 0 ? strain.get(ordered[i - 1].date) || 0 : 0;
    const stageSum = (d.deep_minutes || 0) + (d.light_minutes || 0) + (d.rem_minutes || 0);
    const sleepMinutes = d.sleep_minutes || stageSum || (d.sleep_hours ? d.sleep_hours * 60 : null);
    const sleep_hours = sleepMinutes ? r1(sleepMinutes / 60) : null;
    const sleep_need_base = r1(7.5 + priorStrain * 0.05);
    // A nap is never added to the night above; it only pays down the need of the night
    // it precedes, capped so the adjusted need keeps at least half of the base need.
    // sleep_need is in HOURS, so the credited minutes are converted before subtracting.
    const creditedMinutes = napCredits.get(d.date) || 0;
    const napCredit = Math.min(NAP_NEED_CREDIT * (creditedMinutes / 60), sleep_need_base * (1 - NAP_NEED_FLOOR));
    const sleep_need = r1(Math.max(sleep_need_base * NAP_NEED_FLOOR, sleep_need_base - napCredit));
    // Recovery keeps reading the unadjusted performance, so naps can never move it.
    const sleep_performance_base = sleep_hours ? Math.round(clamp((sleep_hours / sleep_need_base) * 100, 0, 100)) : null;
    const sleep_performance = sleep_hours ? Math.round(clamp((sleep_hours / sleep_need) * 100, 0, 100)) : null;

    const base = baselineV5AsOf(ordered, d.date);
    const composite = recoveryCompositeV5(d.hrv, d.resting_hr, sleep_performance_base, base);
    const nights = ordered.filter((x) => x.date <= d.date).slice(-SCORING_CONFIG.sleep.consistencyNights);
    const sleepSessionEnded = typeof d.sleep_end === "string" && Number.isFinite(Date.parse(d.sleep_end));
    prepared.push({ day: d, base, composite, napCredit, sleep_hours, sleep_need, sleep_need_base, sleep_performance, sleep_performance_base, nights, sleepSessionEnded });
  }

  const speed = personalRecoverySpeed(prepared, workouts);
  let latestCompletedZc = null;
  for (const entry of prepared) {
    const { day: d, base, composite, napCredit, sleep_hours, sleep_need, sleep_need_base, sleep_performance, sleep_performance_base, nights, sleepSessionEnded } = entry;
    const timezone = d.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const snapshotAt = localSnapshotTime(d.date, timezone);
    const sleepEnd = d.sleep_end ? localDateTimeToEpoch(d.sleep_end, timezone) : NaN;
    const completedBySnapshot = sleepSessionEnded && Number.isFinite(sleepEnd)
      && sleepEnd <= snapshotAt
      && String(d.sleep_end).slice(0, 10) === d.date;
    if (completedBySnapshot && isNum(composite.zc)) latestCompletedZc = composite.zc;
    const bodyZc = completedBySnapshot ? composite.zc : latestCompletedZc;
    const lastStrainAt = d.strain_sampled_at ? localDateTimeToEpoch(d.strain_sampled_at, timezone) : null;
    const recoveryNow = recoveryAtTime(workouts, bodyZc, snapshotAt, speed.value, lastStrainAt);
    const recoveryComponents = {
      hrv: isNum(d.hrv) ? d.hrv : null,
      hrv_z: composite.hrvZ == null ? null : r2(composite.hrvZ),
      rhr: isNum(d.resting_hr) ? d.resting_hr : null,
      rhr_z: composite.rhrZ == null ? null : r2(composite.rhrZ),
      sleep_perf: sleep_performance_base,
      sleep_z: composite.sleepZ == null ? null : r2(composite.sleepZ),
      zc: composite.zc == null ? null : r2(composite.zc),
      v5_composite_z: composite.zc == null ? null : r2(composite.zc),
      old_v4_score: null,
      new_v5_score: null,
      hrv_for_90: null,
      hrv_for_99: null,
      hrv_sample_count: d.hrv_samples_count ?? null,
      rhr_sample_count: d.rhr_samples_count ?? null,
      sleep_session_ended: completedBySnapshot,
      hrv_baseline: base.hrv,
      hrv_sd_eff: base.hrvSd,
      hrv_baseline_n: base.hrvN,
      rhr_baseline: base.rhr,
      rhr_sd_eff: base.rhrSd,
      rhr_baseline_n: base.rhrN,
      workout_debt: recoveryNow.workout_debt,
      physio_penalty: recoveryNow.physio_penalty,
      debt_sessions: recoveryNow.recovery_sessions,
      personal_speed: speed.value,
      personal_speed_label: speed.label,
      personal_speed_workout_days: speed.workoutDays,
      snapshot_at: new Date(snapshotAt).toISOString(),
    };
    const today = dateInTimezone(new Date(), timezone);
    const provisional = d.date === today && !completedBySnapshot;
    const scored = {
      strain: strain.get(d.date),
      recovery: recoveryNow.recovery,
      recovery_provisional: provisional,
      workout_debt: recoveryNow.workout_debt,
      physio_penalty: recoveryNow.physio_penalty,
      time_to_full_hours: recoveryNow.time_to_full_hours,
      recovery_evaluated_at: new Date(snapshotAt).toISOString(),
      recovery_status: recoveryNow.recovery_status,
      recovery_still_accruing: recoveryNow.recovery_still_accruing,
      recovery_sessions: recoveryNow.recovery_sessions,
      recovery_rating: d.recovery_rating ?? null,
      sleep_hours,
      sleep_need,
      sleep_need_base,
      sleep_performance,
      sleep_performance_base,
      // The credit exactly as applied, so the card never has to read it back off two
      // values that were each rounded to 0.1 h.
      nap_need_credit_minutes: napCredit > 0 ? Math.round(napCredit * 60) : 0,
      recovery_projection: null,
      recovery_projection_low: null,
      recovery_projection_high: null,
      recovery_rate: null,
      recovery_rate_spread: null,
      recovery_rate_pairs: 0,
      recovery_rate_confidence: 0,
      sleep_consistency: sleepConsistency(nights),
      sleep_duration_variability: durationVariability(nights),
      baseline_hrv: base.hrv,
      baseline_hrv_logsd: r2(base.hrvSd),
      baseline_rhr: base.rhr,
      baseline_rhr_sd: r2(base.rhrSd),
      baseline_days: Math.max(base.hrvN, base.rhrN),
      baseline_confidence: r2(Math.max(base.hrvN, base.rhrN) / v5Config.baselineWindow),
      recovery_components: recoveryComponents,
      algo_version: ALGO_VERSION,
    };
    if (wanted.has(d.date)) out.set(d.date, scored);
  }
  return out;
}
// Health scoring model (aether-scores-v4).

export const ALGO_VERSION = "aether-scores-v4";
export const MAX_HR = 190;
export const ZONE_EDGES = [0.25, 0.45, 0.6, 0.75, 0.88];
const ZONE_MULT = [0.4, 1, 1.8, 2.8, 4];
const LOAD_DIVISOR = 120;

const BASELINE_WINDOW = 30;
const DEFAULT_HRV = 45;
const DEFAULT_RHR = 62;
const DEFAULT_HRV_SD = 12;
const DEFAULT_RHR_SD = 4;
const MIN_HRV_SD = 5;
const MIN_RHR_SD = 2;

const RECOVERY_NEUTRAL = 58;
const W_HRV_Z = 10;
const W_RHR_Z = 8;
const W_SLEEP = 0.4;

const RATE_MIN = -10;
const RATE_MAX = 25;
const RATE_MAX_GAP_H = 36;
const RATE_MIN_PAIRS = 5;
const RATE_FULL_PAIRS = 20;
const RATE_WINDOW = 60;
const REST_STRAIN = 10;
const RECOVERY_CEILING = 90;

const CONSISTENCY_K = 0.25;
const CONSISTENCY_NIGHTS = 7;

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

export function baselineAsOf(history, date) {
  const win = history.filter((d) => d.date < date).slice(-BASELINE_WINDOW);
  const confidence = Math.min(1, win.length / BASELINE_WINDOW);
  const blend = (personal, fallback) => (isNum(personal) ? confidence * personal + (1 - confidence) * fallback : fallback);
  const logs = win.map((d) => d.hrv).filter((v) => isNum(v) && v > 0).map((v) => Math.log(v));
  const rhrs = win.map((d) => d.resting_hr).filter((v) => isNum(v) && v > 0);
  const hrvLog = blend(logs.length ? mean(logs) : null, Math.log(DEFAULT_HRV));
  const hrvLogSd = Math.max(MIN_HRV_SD / DEFAULT_HRV, blend(logs.length > 1 ? sd(logs) : null, DEFAULT_HRV_SD / DEFAULT_HRV));
  const rhr = blend(rhrs.length ? mean(rhrs) : null, DEFAULT_RHR);
  const rhrSd = Math.max(MIN_RHR_SD, blend(rhrs.length > 1 ? sd(rhrs) : null, DEFAULT_RHR_SD));
  return { days: win.length, confidence, hrv: r1(Math.exp(hrvLog)), hrvLog, hrvLogSd, rhr: r1(rhr), rhrSd: r1(rhrSd) };
}

function recoveryScore(d, base, sleepPerformance) {
  const hrv = isNum(d.hrv) && d.hrv > 0 ? d.hrv : null;
  const rhr = isNum(d.resting_hr) && d.resting_hr > 0 ? d.resting_hr : null;
  if (hrv == null && rhr == null) return null;
  let s = RECOVERY_NEUTRAL;
  if (hrv != null) s += W_HRV_Z * ((Math.log(hrv) - base.hrvLog) / base.hrvLogSd);
  if (rhr != null) s -= W_RHR_Z * ((rhr - base.rhr) / base.rhrSd);
  if (sleepPerformance != null) s += (sleepPerformance - 80) * W_SLEEP;
  return Math.round(clamp(s, 1, 99));
}

export function recoveryRateAsOf(history, date) {
  const prior = history.filter((d) => d.date < date).slice(-RATE_WINDOW);
  const rests = (d) => isNum(d.strain) && d.strain <= REST_STRAIN && isNum(d.recovery) && d.recovery < RECOVERY_CEILING;
  const deltas = [];
  for (let i = 1; i < prior.length; i++) {
    const a = prior[i - 1];
    const b = prior[i];
    if (!rests(a) || !rests(b)) continue;
    const hours = (Date.parse(b.date) - Date.parse(a.date)) / 3600000;
    if (!(hours > 0) || hours > RATE_MAX_GAP_H) continue;
    deltas.push(b.recovery - a.recovery);
  }
  const pairs = deltas.length;
  const learned = pairs >= RATE_MIN_PAIRS;
  const rate = learned ? r1(clamp(mean(deltas), RATE_MIN, RATE_MAX)) : null;
  const spread = learned && deltas.length > 1 ? r1(sd(deltas)) : null;
  return { rate, spread, confidence: learned ? Math.min(1, pairs / RATE_FULL_PAIRS) : 0, pairs, learned };
}

export function nextDayProjection(recovery, rate, spread) {
  if (recovery == null || !isNum(rate)) return null;
  const mid = recovery + rate;
  const half = isNum(spread) ? spread : 0;
  const band = (v) => Math.round(clamp(v, 1, 99));
  return { mid: band(mid), low: band(mid - half), high: band(mid + half) };
}

function anchorMinutes(ts) {
  const m = String(ts || "").match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  return (h < 12 ? h + 12 : h - 12) * 60 + Number(m[2]);
}

export function sleepConsistency(nights) {
  const bed = nights.map((d) => anchorMinutes(d.sleep_start)).filter(isNum);
  const wake = nights.map((d) => anchorMinutes(d.sleep_end)).filter(isNum);
  if (bed.length < 2 || wake.length < 2) return null;
  return Math.round(clamp(100 - CONSISTENCY_K * (sd(bed) + sd(wake)), 0, 100));
}

export function durationVariability(nights) {
  const hours = nights.map((d) => d.sleep_hours).filter(isNum);
  if (hours.length < 2) return null;
  return Math.round(sd(hours) * 60);
}

export function computeScores(days, workouts, targets) {
  const ordered = [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)));
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
  for (let i = 0; i < ordered.length; i++) {
    const d = ordered[i];
    if (!wanted.has(d.date)) continue;
    const priorStrain = i > 0 ? strain.get(ordered[i - 1].date) || 0 : 0;
    const stageSum = (d.deep_minutes || 0) + (d.light_minutes || 0) + (d.rem_minutes || 0);
    const sleepMinutes = d.sleep_minutes || stageSum || (d.sleep_hours ? d.sleep_hours * 60 : null);
    const sleep_hours = sleepMinutes ? r1(sleepMinutes / 60) : null;
    const sleep_need = r1(7.5 + priorStrain * 0.05);
    const sleep_performance = sleep_hours ? Math.round(clamp((sleep_hours / sleep_need) * 100, 0, 100)) : null;

    const base = baselineAsOf(ordered, d.date);
    const recovery = recoveryScore(d, base, sleep_performance);
    const rate = recoveryRateAsOf(ordered, d.date);
    const projection = nextDayProjection(recovery, rate.rate, rate.spread);
    const nights = ordered.filter((x) => x.date <= d.date).slice(-CONSISTENCY_NIGHTS);

    out.set(d.date, {
      strain: strain.get(d.date),
      recovery,
      sleep_hours,
      sleep_need,
      sleep_performance,
      recovery_projection: projection ? projection.mid : null,
      recovery_projection_low: projection ? projection.low : null,
      recovery_projection_high: projection ? projection.high : null,
      sleep_consistency: sleepConsistency(nights),
      sleep_duration_variability: durationVariability(nights),
      baseline_hrv: base.hrv,
      baseline_hrv_logsd: r2(base.hrvLogSd),
      baseline_rhr: base.rhr,
      baseline_rhr_sd: r2(base.rhrSd),
      baseline_days: base.days,
      baseline_confidence: r2(base.confidence),
      recovery_rate: rate.rate,
      recovery_rate_spread: rate.spread,
      recovery_rate_pairs: rate.pairs,
      recovery_rate_confidence: r2(rate.confidence),
      algo_version: ALGO_VERSION,
    });
  }
  return out;
}
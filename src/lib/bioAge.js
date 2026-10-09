// Client-side Biological Age computation. No AI, no integration calls — pure
// scoring from existing day metrics and workouts. Mirrors the additive zone rule
// used for day strain so long sessions are never undercounted.

import {
  FACTORS, factorScore, factorAnchors, MAX_TOTAL_YEARS, CONFIDENCE_FULL_DAYS, WINDOW_DAYS,
  MIN_DAYS_UNLOCK, MIN_FACTORS_UNLOCK, MIN_DAYS_PER_FACTOR, BIO_AGE_CONFIG_VERSION,
} from "./bioAgeConfig";

// Must match the scoring module's zone definitions so session minutes land in the
// same buckets the rest of the app uses.
const ZONE_EDGES = [0.25, 0.45, 0.6, 0.75, 0.88];
const MAX_HR = 190;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function zoneForHr(hr, rhr) {
  if (!isNum(hr) || !isNum(rhr)) return -1;
  const reserve = Math.max(60, MAX_HR - rhr);
  const hrr = (hr - rhr) / reserve;
  for (let z = ZONE_EDGES.length - 1; z >= 0; z--) if (hrr >= ZONE_EDGES[z]) return z;
  return -1;
}

function sleepHours(d) {
  if (isNum(d.sleep_hours)) return d.sleep_hours;
  if (isNum(d.sleep_minutes)) return d.sleep_minutes / 60;
  const sum = (d.deep_minutes || 0) + (d.light_minutes || 0) + (d.rem_minutes || 0);
  return sum ? sum / 60 : null;
}

// Per-day aerobic-weighted zone minutes under the additive rule (FIX 3 / FIX 9):
// the day's own HR trace OUTSIDE any session (zone_minutes_residual) plus each
// session's own per-second-stream zone minutes — the same array FIX 9 builds from a
// workout's HR stream and now stores on the Workout record. A session with no stream
// falls back to its average-HR zone × duration. The whole-day trace is never used on
// covered days, so a session is credited on its own terms and never double-counted
// against the residual.
function dayAerobicZones(d, workouts, rhr) {
  const zones = [0, 0, 0, 0, 0];
  const residual = Array.isArray(d.zone_minutes_residual) && d.zone_minutes_residual.length === 5
    ? d.zone_minutes_residual : null;
  if (residual) for (let i = 0; i < 5; i++) zones[i] += residual[i] || 0;
  const rest = isNum(d.resting_hr) ? d.resting_hr : rhr;
  for (const w of workouts || []) {
    const mins = Number(w.duration_min || 0);
    if (!mins) continue;
    const hasStream = Array.isArray(w.zone_minutes) && w.zone_minutes.length === 5 && w.zone_minutes.some((m) => m > 0);
    if (hasStream) {
      for (let i = 0; i < 5; i++) zones[i] += w.zone_minutes[i] || 0;
    } else {
      const hr = isNum(w.avg_hr) ? w.avg_hr : rest + 40;
      const z = zoneForHr(hr, rest);
      if (z >= 0) zones[z] += mins;
    }
  }
  return zones;
}

// (Z2 + Z3) + 2*(Z4 + Z5) aerobic weighting.
const aerobicOf = (z) => (z[1] || 0) + (z[2] || 0) + 2 * ((z[3] || 0) + (z[4] || 0));

export function computeBioAge({ metrics, workouts, age }) {
  const windowData = (metrics || []).slice(-WINDOW_DAYS);
  const workoutsByDate = new Map();
  for (const w of workouts || []) {
    if (!workoutsByDate.has(w.date)) workoutsByDate.set(w.date, []);
    workoutsByDate.get(w.date).push(w);
  }
  const rhrFallback = mean(windowData.map((d) => d.resting_hr).filter(isNum)) || 62;
  const totalDays = windowData.length;

  let sleepSum = 0, sleepN = 0;
  let consSum = 0, consN = 0;
  let rhrSum = 0, rhrN = 0;
  let stepsSum = 0, stepsN = 0;
  let aeroTotal = 0, aeroDays = 0;

  for (const d of windowData) {
    const h = sleepHours(d);
    if (isNum(h)) { sleepSum += h; sleepN++; }
    if (isNum(d.sleep_consistency)) { consSum += d.sleep_consistency; consN++; }
    if (isNum(d.resting_hr)) { rhrSum += d.resting_hr; rhrN++; }
    if (isNum(d.steps)) { stepsSum += d.steps; stepsN++; }
    const ws = workoutsByDate.get(d.date) || [];
    const aero = aerobicOf(dayAerobicZones(d, ws, rhrFallback));
    if (aero > 0 || d.hr_covered) { aeroTotal += aero; aeroDays++; }
  }

  const factors = [];
  const push = (id, value, validDays) => {
    const def = FACTORS[id];
    if (validDays < MIN_DAYS_PER_FACTOR || value == null) {
      factors.push({ id, ...def, value: null, validDays, score: null, years: 0, excluded: true });
    } else {
      const s = clamp(factorScore(factorAnchors(id, age), value), -1, 1);
      factors.push({ id, ...def, value, validDays, score: s, years: -s * def.maxYears, excluded: false });
    }
  };
  push("sleep", sleepN ? sleepSum / sleepN : null, sleepN);
  push("consistency", consN ? consSum / consN : null, consN);
  push("rhr", rhrN ? rhrSum / rhrN : null, rhrN);
  push("steps", stepsN ? stepsSum / stepsN : null, stepsN);
  const weeklyAero = aeroDays ? (aeroTotal * 7) / aeroDays : null;
  push("activity", weeklyAero, aeroDays);

  const activeFactors = factors.filter((f) => !f.excluded);
  const conf = clamp(totalDays / CONFIDENCE_FULL_DAYS, 0, 1);
  const yearsShown = factors.map((f) => (f.excluded ? 0 : f.years * conf));
  const totalRaw = yearsShown.reduce((a, b) => a + b, 0);
  const totalYears = clamp(totalRaw, -MAX_TOTAL_YEARS, MAX_TOTAL_YEARS);
  const unlocked = totalDays >= MIN_DAYS_UNLOCK && activeFactors.length >= MIN_FACTORS_UNLOCK;
  const earlyEstimate = conf < 1;

  // Last-30-day vs full-window trend per factor.
  const last30 = windowData.slice(-30);
  const trendFor = (sel) => {
    const w = sel(windowData), l = sel(last30);
    if (l == null || w == null) return null;
    return { last30: l, window: w, dir: l > w ? "up" : l < w ? "down" : "flat" };
  };
  const sleepSel = (arr) => mean(arr.map(sleepHours).filter(isNum));
  const trends = {
    sleep: trendFor(sleepSel),
    rhr: trendFor((arr) => mean(arr.map((d) => d.resting_hr).filter(isNum))),
    steps: trendFor((arr) => mean(arr.map((d) => d.steps).filter(isNum))),
  };

  return {
    version: BIO_AGE_CONFIG_VERSION,
    age,
    unlocked,
    earlyEstimate,
    days: totalDays,
    windowDays: totalDays,
    factorCount: activeFactors.length,
    confidence: conf,
    bioAge: unlocked && isNum(age) ? Math.round(age + totalYears) : null,
    totalYears: unlocked ? Math.round(totalYears * 10) / 10 : null,
    factors: factors.map((f) => ({
      ...f,
      yearsShown: f.excluded ? 0 : Math.round(f.years * conf * 100) / 100,
      trend: trends[f.id] || null,
    })),
  };
}

// Auditable daily snapshot. Factor values, years per factor, config version, window.
export function bioAgeSnapshot(result) {
  return {
    version: result.version,
    date: new Date().toISOString().slice(0, 10),
    age: result.age,
    days: result.days,
    factorCount: result.factorCount,
    confidence: result.confidence,
    bioAge: result.bioAge,
    totalYears: result.totalYears,
    windowLength: result.days,
    factorValues: Object.fromEntries(result.factors.map((f) => [f.id, f.value])),
    factorYears: Object.fromEntries(result.factors.map((f) => [f.id, f.yearsShown || 0])),
  };
}
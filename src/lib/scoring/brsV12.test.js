// BRS v1.2: the card's "time to full recovery" is shown from workout debt alone.
//
// The body-signal penalty decays from the instant it is evaluated, so including it in the
// displayed estimate made it restart at full strength every time the app was opened: a bad
// night's resting HR / HRV read as a ~39 hour countdown that never moved, even with no
// workout debt left. The stored fields are untouched by that decision — recoveryAtTime() and
// computeScores() still store the penalty-included time_to_full_hours, and the headline
// Recovery number is identical either way. Only what the card displays changes.
import test from "node:test";
import assert from "node:assert/strict";
import { hoursToRecoverFromDebt, recoveryAtTime } from "./scores.js";
import { SCORING_CONFIG } from "./config.js";
import { recoveryEtaLabel } from "../metrics.js";

// The zc that produces a given body-signal penalty, so the tests can talk in penalty points.
const PENALTY_Z = (penalty) => -penalty / SCORING_CONFIG.recoveryV6.physioPenaltyPerNegativeZ;

const workout = ({ date, endedAt, recoveryMinutes }) => ({
  date,
  activity: "Badminton",
  ended_at: endedAt,
  recovery_time_min: recoveryMinutes,
  duration_min: 60,
  avg_hr: 145,
  strain: 10,
});

test("BRS v1.2: cleared workout debt reports no hours left while the penalty still holds Recovery down", () => {
  // The real case: badminton ended 13 h ago with a 420 min recovery time, so its debt is long
  // gone, while zc is negative enough for a 22.7 point body-signal penalty. Recovery is 77%.
  const at = new Date("2026-10-21T06:00:00.000Z");
  const ended = new Date(at.getTime() - 13 * 3600000).toISOString();
  const workouts = [workout({ date: "2026-10-20", endedAt: ended, recoveryMinutes: 420 })];
  const zc = PENALTY_Z(22.7);

  assert.equal(hoursToRecoverFromDebt(workouts, at, 1), 0);

  const stored = recoveryAtTime(workouts, zc, at, 1);
  assert.equal(stored.workout_debt, 0);
  assert.equal(stored.recovery_sessions.length, 0);
  assert.equal(stored.physio_penalty, 22.7);
  assert.equal(stored.recovery, 77);
  // The stored estimate is unchanged and is still penalty-driven: this is the 39 h the card
  // used to print, and it is exactly what BRS v1.2 stops showing.
  assert.equal(stored.time_to_full_hours, 39);
});

test("BRS v1.2: a 420-minute workout an hour old clears on debt decay alone", () => {
  const at = new Date("2026-10-21T19:30:00.000Z");
  const ended = new Date(at.getTime() - 3600000).toISOString();
  const workouts = [workout({ date: "2026-10-21", endedAt: ended, recoveryMinutes: 420 })];

  // Debt at 1 h is 24.5 * (1 - 1/7) = 21 points, and 2 points are tolerated at "fully
  // recovered", so the debt side clears once 1 + h >= 7 * (1 - 2/24.5), i.e. at h = 6.
  assert.equal(hoursToRecoverFromDebt(workouts, at, 1), 6);

  const clean = recoveryAtTime(workouts, 0, at, 1);
  const penalised = recoveryAtTime(workouts, PENALTY_Z(30), at, 1);
  // The debt curve the display now follows does not move when the penalty does...
  assert.equal(clean.workout_debt, penalised.workout_debt);
  // ...while the stored estimate still does: 6 h clean, 44 h once a 30 point penalty has to
  // decay to the same 2 point threshold.
  assert.equal(clean.time_to_full_hours, 6);
  assert.equal(penalised.time_to_full_hours, 44);
});

test("BRS v1.2: the back-to-100% clock carries the weekday only when the target is another day", () => {
  const zone = "Europe/Berlin";
  const now = Date.parse("2026-10-21T00:30:00.000Z"); // Wed 02:30 local (CEST)
  const today = Date.parse("2026-10-21T00:13:00.000Z"); // Wed 02:13 local
  const later = Date.parse("2026-10-23T00:13:00.000Z"); // Fri 02:13 local

  assert.equal(recoveryEtaLabel(today, zone, { now, locale: "en-US" }), "2:13 am");
  assert.equal(recoveryEtaLabel(later, zone, { now, locale: "en-US" }), "Fri 2:13 am");
  assert.equal(recoveryEtaLabel(NaN, zone, { now, locale: "en-US" }), null);
});
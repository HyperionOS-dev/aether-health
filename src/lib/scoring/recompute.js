// Refresh the trailing 60-day window plus requested dates against an `{ entities }` store.
import { computeScores } from "@/lib/scoring/scores";
import { SCORING_CONFIG } from "@/lib/scoring/config";

const WINDOW = SCORING_CONFIG.recoveryV6.personalWindowDays;

export async function recomputeScores(store, dates = []) {
  const days = await store.entities.DailyMetric.filter({}, "-date", 2000);
  if (!days.length) return 0;
  const workouts = await store.entities.Workout.filter({}, "-date", 2000);
  const ordered = [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const targets = [...new Set([...ordered.slice(-WINDOW).map((d) => d.date), ...dates])];
  const scores = computeScores(ordered, workouts, targets);
  const updates = days.filter((d) => scores.has(d.date)).map((d) => ({ id: d.id, ...scores.get(d.date) }));
  await store.entities.DailyMetric.bulkUpdate(updates);
  return updates.length;
}
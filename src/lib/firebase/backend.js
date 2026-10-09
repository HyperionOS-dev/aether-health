import { entities, me, updateMe } from "@/lib/firebase/entities";
import { strainFromMet } from "@/lib/scoring/scores";
import { recomputeScores } from "@/lib/scoring/recompute";
import { METS, kcalBurn } from "@/lib/scoring/met";

// The logWorkout function's behaviour, run in the browser against Firestore.
const store = { entities };

export const firebaseBackend = {
  me,
  updateMe,
  entities,
  async logWorkout({ date, activity, duration_min }) {
    const user = await me();
    let weight = Number(user.weight_kg) || null;
    if (!weight) {
      const recent = await entities.DailyMetric.filter({}, "-date", 60);
      weight = Number(recent.find((d) => d.weight)?.weight) || 75;
    }
    const minutes = Math.round(Number(duration_min));
    const met = METS[activity] ?? 5;
    const workout = await entities.Workout.create({
      date,
      activity,
      duration_min: minutes,
      calories: kcalBurn(met, minutes, weight),
      strain: strainFromMet(minutes, met),
    });
    await recomputeScores(store, [date]);
    return { workout };
  },
};
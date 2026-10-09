import { useQuery } from "@tanstack/react-query";
import { backend } from "@/api/backend";
import { getDemoData } from "@/lib/demoData";
import { useDemoMode } from "@/hooks/useDemoMode";

export default function useHealthData() {
  const demo = useDemoMode();
  return useQuery({
    queryKey: ["health", demo || "real"],
    queryFn: async () => {
      if (demo) return getDemoData(demo);
      const me = await backend.me();
      const [metrics, workouts, logs] = await Promise.all([
        backend.entities.DailyMetric.filter({ created_by_id: me.id }, "-date", 400),
        backend.entities.Workout.filter({ created_by_id: me.id }, "-date", 1000),
        backend.entities.ImportLog.filter({ created_by_id: me.id }, "-created_date", 20),
      ]);
      return { metrics: [...metrics].sort((a, b) => a.date.localeCompare(b.date)), workouts, logs };
    },
  });
}
import Card from "./Card";
import DualDial from "./DualDial";
import ScoreRing from "./ScoreRing";
import InsightCard from "./InsightCard";
import MetricTile from "./MetricTile";
import { COLORS, recoveryTone, avg, fmtHours } from "@/lib/metrics";

export default function Hero({ day, history }) {
  const week = history.slice(-8, -1);
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card className="flex items-center justify-center py-8">
        <DualDial strain={day?.strain} recovery={day?.recovery} />
      </Card>
      <div className="flex flex-col gap-4">
        <Card className="flex justify-around py-6">
          <ScoreRing label="Sleep" value={day?.sleep_performance} max={100} color={COLORS.sleep}
            display={day?.sleep_performance != null ? `${day.sleep_performance}%` : "--"} />
          <ScoreRing label="Recovery" value={day?.recovery} max={100} color={recoveryTone(day?.recovery).color}
            display={day?.recovery != null ? `${day.recovery}%` : "--"} />
          <ScoreRing label="Strain" value={day?.strain} max={21} color={COLORS.strain} display={day?.strain ?? "--"} />
        </Card>
        <InsightCard day={day} />
        <div className="grid grid-cols-2 gap-3">
          <MetricTile label="HRV" value={day?.hrv} unit="ms" average={r1(avg(week, "hrv"))} />
          <MetricTile label="Resting HR" value={day?.resting_hr} unit="bpm" average={r1(avg(week, "resting_hr"))} lowerIsBetter />
          <MetricTile label="Calories" value={day?.calories} unit="cal" average={r1(avg(week, "calories"))} />
          <MetricTile label="Sleep Need" value={day?.sleep_need != null ? fmtHours(day.sleep_need) : null} unit="hrs" />
        </div>
      </div>
    </section>
  );
}
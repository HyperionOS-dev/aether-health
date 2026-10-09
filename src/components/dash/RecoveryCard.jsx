import Card from "./Card";
import Label from "./Label";
import Sparkline from "./Sparkline";
import { COLORS, recoveryTone } from "@/lib/metrics";

function Stat({ label, value, unit }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-1 font-display text-xl font-bold">
        {value ?? "--"}
        {value != null && <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}

function projectionLabel(low, high) {
  if (low == null || high == null) return "--";
  return low === high ? `≈ ${low}%` : `≈ ${low}–${high}%`;
}

export default function RecoveryCard({ day, history }) {
  const tone = recoveryTone(day?.recovery);
  const pairs = day?.recovery_rate_pairs ?? 0;
  const hasProjection = day?.recovery_projection_low != null && day?.recovery_projection_high != null;
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <Label>Recovery</Label>
          <p className="font-display text-[32px] font-bold" style={{ color: tone.color }}>
            {day?.recovery != null ? `${day.recovery}%` : "--"}
          </p>
        </div>
        <span className="rounded-full border border-hairline px-3 py-1 text-xs" style={{ color: tone.color }}>{tone.label}</span>
      </div>
      <Label className="mt-4">HRV trend · 14 days</Label>
      <Sparkline data={history} dataKey="hrv" color={COLORS.recovery} height={96} />
      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4">
        <div>
          <Label>Tomorrow's projection</Label>
          <p className="text-[10px] text-muted-foreground">Projection, not a measurement — assumes a rest day</p>
          <p className="text-[10px] text-muted-foreground">
            {hasProjection
              ? `Your rate: ${day.recovery_rate} pts per rest day · ${pairs} rest-day pairs`
              : `Still learning your rate — ${pairs} of 5 rest-day pairs logged`}
          </p>
        </div>
        <span className="font-display text-lg font-bold">
          {projectionLabel(day?.recovery_projection_low, day?.recovery_projection_high)}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
        <Stat label="RHR" value={day?.resting_hr} unit="bpm" />
        <Stat label="Skin temp" value={day?.skin_temp} unit="°C" />
        <Stat label="Resp. rate" value={day?.respiratory_rate} unit="rpm" />
      </div>
    </Card>
  );
}
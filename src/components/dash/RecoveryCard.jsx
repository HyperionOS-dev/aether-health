import { useQueryClient } from "@tanstack/react-query";
import Card from "./Card";
import Label from "./Label";
import Sparkline from "./Sparkline";
import { backend } from "@/api/backend";
import { recoveryTone } from "@/lib/metrics";
import { SCORING_CONFIG, SHOW_RECOVERY_DETAILS } from "@/lib/scoring/config";

function correlation(rows) {
  const pairs = rows.filter((row) => Number.isFinite(row.recovery_rating) && Number.isFinite(row.recovery));
  if (pairs.length < 2) return null;
  const meanX = pairs.reduce((sum, row) => sum + row.recovery, 0) / pairs.length;
  const meanY = pairs.reduce((sum, row) => sum + row.recovery_rating, 0) / pairs.length;
  const covariance = pairs.reduce((sum, row) => sum + (row.recovery - meanX) * (row.recovery_rating - meanY), 0);
  const spreadX = pairs.reduce((sum, row) => sum + (row.recovery - meanX) ** 2, 0);
  const spreadY = pairs.reduce((sum, row) => sum + (row.recovery_rating - meanY) ** 2, 0);
  return spreadX && spreadY ? covariance / Math.sqrt(spreadX * spreadY) : null;
}

function Stat({ label, value, unit, caption = null }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-1 font-display text-xl font-bold">
        {value ?? "--"}
        {value != null && <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span>}
      </p>
      {caption && <p className="mt-0.5 text-[10px] text-muted-foreground">{caption}</p>}
    </div>
  );
}

export default function RecoveryCard({ day, history = [] }) {
  const queryClient = useQueryClient();
  const tone = recoveryTone(day?.recovery);
  const components = day?.recovery_components;
  const recent = history.filter((row) => row.date <= day?.date).slice(-14);
  const report = recent.slice().reverse();
  const ratings = history.filter((row) => row.date <= day?.date && Number.isFinite(row.recovery_rating));
  const recoveryConfig = SCORING_CONFIG.recoveryV6;
  const ratingScale = Array.from({ length: recoveryConfig.ratingMax - recoveryConfig.ratingMin + 1 }, (_, index) => index + recoveryConfig.ratingMin);
  const isDemo = day?.source === "demo";
  const r = day?.recovery;
  const timezone = day?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const evaluatedAt = day?.recovery_evaluated_at || components?.snapshot_at;
  const etaTimestamp = evaluatedAt && day?.time_to_full_hours != null
    ? Date.parse(evaluatedAt) + day.time_to_full_hours * 3600000
    : NaN;
  const eta = Number.isFinite(etaTimestamp)
    ? new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(etaTimestamp)
    : null;
  const timeToFull = day?.recovery_still_accruing
    ? "Still accruing"
    : r >= 98
      ? "Fully recovered"
      : day?.time_to_full_hours != null
        ? `~${day.time_to_full_hours}h`
        : ">72h";
  // RHR, skin temp and respiratory rate belong to one day only, so none is carried over from
  // an earlier day: a day without its own reading shows "--".
  const rhr = Number.isFinite(day?.resting_hr) ? day.resting_hr : null;
  const skinTemp = Number.isFinite(day?.skin_temp) ? day.skin_temp : null;
  const respiratoryRate = Number.isFinite(day?.respiratory_rate) ? day.respiratory_rate : null;
  const respiratoryBaseline = Number.isFinite(day?.respiratory_rate_baseline_min) && Number.isFinite(day?.respiratory_rate_baseline_max)
    ? `usual ${day.respiratory_rate_baseline_min}-${day.respiratory_rate_baseline_max}`
    : null;

  async function saveRating(value) {
    if (!day?.date) return;
    if (day.id) {
      await backend.entities.DailyMetric.bulkUpdate([{ id: day.id, recovery_rating: value }]);
    } else {
      await backend.entities.DailyMetric.create({ date: day.date, recovery_rating: value });
    }
    await queryClient.invalidateQueries({ queryKey: ["health"] });
  }

  return (
    <Card className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label>RECOVERY</Label>
          <p className="font-display text-[32px] font-bold" style={{ color: tone.color }}>
            {r != null ? `${r}%` : "--"}
          </p>
          {day?.recovery_provisional && (
            <p className="mt-1 text-[10px] font-medium text-caution">Provisional, waiting for last night's sleep</p>
          )}
        </div>
        <span className="rounded-full border border-hairline px-3 py-1 text-xs" style={{ color: tone.color }}>
          {tone.label}
        </span>
      </div>
      {/* The trend is the recovery percentage itself, so the line, the reading above and the
          status pill all share one scale and one colour. Per-night HRV stays in the audit table. */}
      <Label className="mt-4">RECOVERY TREND - 14 DAYS</Label>
      <Sparkline data={recent} dataKey="recovery" color={tone.color} height={96} />
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-4">
        <div>
          <Label>TIME TO FULL RECOVERY</Label>
          <p className="text-[10px] text-muted-foreground">Estimate - from your watch's recovery time, adjusted by your HRV, resting HR and sleep.</p>
          {eta && r < 98 && !day?.recovery_still_accruing && (
            <p className="text-[10px] text-muted-foreground">Back to 100% around {eta}</p>
          )}
        </div>
        <span className="shrink-0 text-right font-display text-lg font-bold">{timeToFull}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
        <Stat label="RHR" value={rhr} unit="bpm" />
        <Stat label="SKIN TEMP" value={skinTemp} unit="°C" />
        <Stat label="RESP. RATE" value={respiratoryRate} unit="br/min" caption={respiratoryBaseline} />
      </div>

      {SHOW_RECOVERY_DETAILS && (
        <>
      <details className="mt-4 border-t border-hairline pt-3">
        <summary className="cursor-pointer list-none text-sm font-semibold">
          Workout load −{Math.round(day?.workout_debt || 0)} · Body signals −{Math.round(day?.physio_penalty || 0)}
        </summary>
        <div className="mt-3 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Workout load</Label><p className="mt-1">−{day?.workout_debt ?? 0}</p></div>
            <div><Label>Body signals</Label><p className="mt-1">−{day?.physio_penalty ?? 0}</p></div>
          </div>
          <p className="text-muted-foreground">
            HRV {components?.hrv ?? "--"} ms · HRV z {components?.hrv_z ?? "--"} · RHR {components?.rhr ?? "--"} bpm · RHR z {components?.rhr_z ?? "--"} · Sleep {components?.sleep_perf ?? "--"}% · zc {components?.zc ?? "--"}
          </p>
          {day?.recovery_sessions?.length > 0 && (
            <div>
              <Label>Sessions driving workout debt</Label>
              <ul className="mt-1 space-y-1">
                {day.recovery_sessions.map((session, index) => (
                  <li key={`${session.end_time}-${index}`} className="flex justify-between gap-2">
                    <span>{session.activity}</span><span>−{session.debt}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted-foreground">
            {components?.personal_speed_label || "Using your watch's estimate"} · recovery speed ×{components?.personal_speed ?? 1}
          </p>
        </div>
      </details>

      <div className="mt-4 border-t border-hairline pt-4">
        <Label>How recovered do you feel?</Label>
        <div className="mt-2 flex gap-2" role="group" aria-label="Rate how recovered you feel from 1 to 5">
          {ratingScale.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`${value} out of 5`}
              aria-pressed={day?.recovery_rating === value}
              disabled={isDemo}
              onClick={() => saveRating(value)}
              className={`h-9 w-9 rounded-full border text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${day?.recovery_rating === value ? "border-recovery bg-recovery text-background" : "border-hairline hover:bg-surface"}`}
            >
              {value}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">1 = not recovered · 5 = fully recovered</p>
      </div>

      <div className="mt-4 border-t border-hairline pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <Label>Personal calibration</Label>
          <span className="text-[10px] text-muted-foreground">{ratings.length} ratings</span>
        </div>
        {ratings.length >= recoveryConfig.correlationMinRatings ? (
          <p className="mt-1 text-sm">Feel vs Recovery: {correlation(ratings) == null ? "Not enough score variation" : `r = ${correlation(ratings).toFixed(2)}`}</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">Correlation appears after {recoveryConfig.correlationMinRatings} daily ratings.</p>
        )}
        {ratings.length > 0 && (
          <div className="mt-2 flex h-14 items-end gap-1" aria-label="Daily feeling ratings and recovery scores">
            {ratings.slice(-30).map((row) => (
              <div key={row.date} className="flex flex-1 flex-col items-center gap-0.5" title={`${row.date}: feel ${row.recovery_rating}/5, recovery ${row.recovery}%`}>
                <span className="w-full rounded-t bg-recovery/70" style={{ height: `${Math.max(3, row.recovery * 0.3)}px` }} />
                <span className="h-2 w-2 rounded-full bg-sleep" style={{ marginBottom: `${row.recovery_rating * 2}px` }} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-hairline pt-4">
        <Label>Recovery audit · last 14 days at 08:00 local</Label>
        {report.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left text-[11px]">
              <thead className="text-muted-foreground">
                <tr className="border-b border-hairline">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">HRV</th>
                  <th className="py-2 pr-3 font-medium">HRV z</th>
                  <th className="py-2 pr-3 font-medium">RHR</th>
                  <th className="py-2 pr-3 font-medium">RHR z</th>
                  <th className="py-2 pr-3 font-medium">Sleep</th>
                  <th className="py-2 pr-3 font-medium">zc</th>
                  <th className="py-2 pr-3 font-medium">Workout debt</th>
                  <th className="py-2 pr-3 font-medium">Body signals</th>
                  <th className="py-2 font-medium">Recovery</th>
                </tr>
              </thead>
              <tbody>
                {report.map((row) => {
                  const audit = row.recovery_components || {};
                  return (
                    <tr key={row.date} className="border-b border-hairline/60 tabular-nums">
                      <td className="whitespace-nowrap py-2 pr-3">{row.date}</td>
                      <td className="py-2 pr-3">{audit.hrv ?? "--"}</td>
                      <td className="py-2 pr-3">{audit.hrv_z ?? "--"}</td>
                      <td className="py-2 pr-3">{audit.rhr ?? "--"}</td>
                      <td className="py-2 pr-3">{audit.rhr_z ?? "--"}</td>
                      <td className="py-2 pr-3">{audit.sleep_perf ?? "--"}</td>
                      <td className="py-2 pr-3">{audit.zc ?? "--"}</td>
                      <td className="py-2 pr-3">−{row.workout_debt ?? "--"}</td>
                      <td className="py-2 pr-3">−{row.physio_penalty ?? "--"}</td>
                      <td className="py-2">{row.recovery ?? "--"}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No daily recovery history yet.</p>
        )}
      </div>
        </>
      )}
    </Card>
  );
}
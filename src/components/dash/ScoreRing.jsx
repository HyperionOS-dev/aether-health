import Label from "./Label";
import { COLORS } from "@/lib/metrics";

export default function ScoreRing({ value, max, color, label, display }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.min(value / max, 1);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-24 w-24 sm:h-28 sm:w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke={COLORS.hairline} strokeWidth="6" />
          <circle
            cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
            style={{ filter: `drop-shadow(0 0 5px ${color})`, transition: "stroke-dashoffset 1s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-display text-2xl font-bold">
          {display}
        </div>
      </div>
      <Label className="text-foreground">{label}</Label>
    </div>
  );
}
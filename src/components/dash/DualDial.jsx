import Label from "./Label";
import { COLORS, recoveryTone } from "@/lib/metrics";

function Arc({ r, width, pct, stroke, glow }) {
  const c = 2 * Math.PI * r;
  return (
    <>
      <circle cx="150" cy="150" r={r} fill="none" stroke={COLORS.hairline} strokeWidth={width} opacity="0.7" />
      <circle
        cx="150" cy="150" r={r} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
        style={{ filter: `drop-shadow(0 0 10px ${glow})`, transition: "stroke-dashoffset 1.2s ease" }}
      />
    </>
  );
}

export default function DualDial({ strain, recovery }) {
  const tone = recoveryTone(recovery);
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]">
      <svg viewBox="0 0 300 300" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="strainGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FF8A3D" />
            <stop offset="100%" stopColor={COLORS.strain} />
          </linearGradient>
        </defs>
        <Arc r={136} width={14} pct={Math.min((strain || 0) / 21, 1)} stroke="url(#strainGrad)" glow={COLORS.strain} />
        <Arc r={110} width={9} pct={(recovery || 0) / 100} stroke={tone.color} glow={tone.color} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <Label>Strain</Label>
        <span className="font-display font-bold leading-none" style={{ fontSize: "clamp(2.5rem, 5vw, 4.5rem)" }}>
          {strain ?? "--"}
        </span>
        <span className="mt-3 font-display text-xl font-bold" style={{ color: tone.color }}>
          {recovery != null ? `${recovery}%` : "--"}
        </span>
        <Label>Recovery</Label>
      </div>
    </div>
  );
}
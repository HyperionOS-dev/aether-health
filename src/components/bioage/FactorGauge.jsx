// Segmented gauge: orange (poor, left) -> lavender (recommended, right) with up to two
// triangle pointers. Top = window average labelled "Avg – {N}d" where N is the real
// window length actually used (capped at 180); bottom = "Last 30d". When the window is
// 30 days or fewer the two averages coincide, so a single pointer is shown.
// For RHR (lower-is-better), pass min > max so lower values land on the lavender side.

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function segColor(t) {
  // strain orange (255,85,0) -> lavender (201,181,232) — app palette
  const r = Math.round(255 + (201 - 255) * t);
  const g = Math.round(85 + (181 - 85) * t);
  const b = Math.round(0 + (232 - 0) * t);
  return `rgb(${r},${g},${b})`;
}

export default function FactorGauge({ min, max, value, last30, unit = "", windowDays = 0 }) {
  const pct = (v) => (v == null || !Number.isFinite(v) ? null : clamp01((v - min) / (max - min)) * 100);
  const valPct = pct(value);
  const l30Pct = pct(last30);
  const N = Math.min(180, Math.max(0, windowDays || 0));
  const single = N > 0 && N <= 30;
  const showTop = valPct != null;
  const showBottom = !single && l30Pct != null;
  const fmt = (v) => {
    if (v == null) return "--";
    return Number.isInteger(v) || v >= 100 ? Math.round(v).toString() : (Math.round(v * 100) / 100).toString();
  };

  return (
    <div className="relative h-16">
      {/* segmented bar (vertically centered) */}
      <div className="absolute inset-x-0 top-1/2 flex h-2.5 -translate-y-1/2 overflow-hidden rounded-full">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-full flex-1" style={{ background: segColor(i / 9) }} />
        ))}
      </div>

      {/* top pointer — window average (single pointer when window <= 30 days) */}
      {showTop && (
        <div className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground" style={{ left: `${valPct}%`, top: 0 }}>
          <span className="text-[#cfcfcf]">{fmt(value)}{unit}</span>
          <span className="ml-1 text-muted-foreground">Avg – {N}d</span>
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-foreground/70" />
        </div>
      )}

      {/* bottom pointer — last 30 days (hidden when the window is <= 30 days) */}
      {showBottom && (
        <div className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground" style={{ left: `${l30Pct}%`, bottom: 0 }}>
          <span className="absolute left-1/2 -top-full -translate-x-1/2 border-l-[5px] border-r-[5px] border-b-[6px] border-l-transparent border-r-transparent border-b-foreground/70" />
          <span className="text-[#cfcfcf]">{fmt(last30)}{unit}</span>
          <span className="ml-1 text-muted-foreground">Last 30d</span>
        </div>
      )}
    </div>
  );
}
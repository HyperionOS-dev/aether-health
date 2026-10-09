const SEGMENTS = [
  { id: "strain", label: "Strain", active: "bg-sleep text-background" },
  { id: "recovery", label: "Recovery", active: "bg-sleep text-background" },
  { id: "sleep", label: "Sleep", active: "bg-sleep text-background" },
];

export default function SegmentPills({ value, onChange }) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-full border border-hairline bg-card p-1">
      {SEGMENTS.map((s) => (
        <button
          key={s.id}
          onClick={() => onChange(s.id)}
          className={`h-11 rounded-full text-xs font-semibold uppercase tracking-[1.5px] transition-colors ${value === s.id ? s.active : "text-muted-foreground"}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
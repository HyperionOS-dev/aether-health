import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const UNITS = ["cm", "ft"];

export default function HeightField({ cm, unit, onUnit, onChange }) {
  const totalIn = cm ? cm / 2.54 : null;
  const feet = totalIn ? Math.floor(totalIn / 12) : "";
  const inches = totalIn ? Math.round(totalIn - Math.floor(totalIn / 12) * 12) : "";

  const fromFeet = (v) => onChange(v === "" ? "" : Math.round((Number(v) * 12 + Number(inches || 0)) * 2.54));
  const fromInches = (v) => onChange(v === "" ? "" : Math.round((Number(feet || 0) * 12 + Number(v)) * 2.54));

  return (
    <div className="space-y-2">
      <Label>Height</Label>
      <div className="flex gap-2">
        {unit === "cm" ? (
          <Input
            type="number"
            inputMode="numeric"
            placeholder="e.g. 178"
            value={cm ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
            className="h-11 rounded-xl border-hairline bg-surface"
          />
        ) : (
          <>
            <Input type="number" inputMode="numeric" placeholder="ft" value={feet} onChange={(e) => fromFeet(e.target.value)} className="h-11 rounded-xl border-hairline bg-surface" />
            <Input type="number" inputMode="numeric" placeholder="in" value={inches} onChange={(e) => fromInches(e.target.value)} className="h-11 rounded-xl border-hairline bg-surface" />
          </>
        )}
        <div className="flex shrink-0 items-center rounded-xl bg-surface p-1">
          {UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => onUnit(u)}
              className={`h-9 rounded-lg px-3 text-xs font-semibold uppercase tracking-[1px] transition-colors ${
                unit === u ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
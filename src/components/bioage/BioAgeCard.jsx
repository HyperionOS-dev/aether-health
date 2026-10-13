import { useEffect, useState } from "react";
import { Info, AlertTriangle } from "lucide-react";
import Card from "@/components/dash/Card";
import { useBioAge, getAge, setAge, loadSnapshots } from "@/hooks/useBioAge";
import { useDemoMode } from "@/hooks/useDemoMode";
import { DEMO_AGE } from "@/lib/demoData";
import AgeDialog from "./AgeDialog";
import AgeBlob from "./AgeBlob";
import CollectingChips from "./CollectingChips";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CONFIDENCE_FULL_DAYS } from "@/lib/bioAgeConfig";
import FactorRow from "./FactorRow";
import AiBubble from "./AiBubble";

export default function BioAgeCard({ metrics, workouts }) {
  const demo = useDemoMode();
  const storedAge = getAge();
  const [localAge, setLocalAge] = useState(storedAge);
  const age = localAge ?? (demo ? DEMO_AGE : null);
  const [askAge, setAskAge] = useState(storedAge == null && !demo);
  const { result, recordSnapshot } = useBioAge(metrics, workouts, age);

  // Store one auditable snapshot per day once unlocked. Never in demo mode.
  useEffect(() => {
    if (!result?.unlocked || demo) return;
    const today = new Date().toISOString().slice(0, 10);
    if (!loadSnapshots()[today]) recordSnapshot();
  }, [result, recordSnapshot]);

  const under18 = age != null && age < 18;
  const total = result?.totalYears;
  const tone = total == null ? "neutral" : total > 0 ? "older" : total < 0 ? "younger" : "neutral";
  const deltaLabel = (() => {
    if (total == null) return "—";
    if (total === 0) return "On your actual age";
    return `${Math.abs(total).toFixed(1)} years ${total < 0 ? "younger" : "older"}`;
  })();

  return (
    <Card className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.25em] text-[#cfcfcf]">Healthspan</h3>
          <p className="text-xs text-muted-foreground">Biological age estimate</p>
        </div>
        <button onClick={() => setAskAge(true)} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
          {age != null ? `Age ${age}` : "Set age"}
        </button>
      </div>

      {/* Central blob */}
      <div className="py-2">
        {result?.unlocked ? (
          <AgeBlob number={result.bioAge} deltaLabel={deltaLabel} deltaTone={tone} size={290} />
        ) : (
          <AgeBlob number="—" deltaLabel="Collecting data" deltaTone="neutral" size={290} />
        )}
      </div>

      {result?.unlocked && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <CollectingChips
            unlocked
            days={result.days}
            factorCount={result.factorCount}
            factors={result.factors}
          />
          {result.earlyEstimate && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="rounded-full border border-hairline bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  Early estimate
                </button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-64 rounded-xl border-hairline bg-card p-3 text-xs text-card-foreground">
                <p>
                  {result.days} of {CONFIDENCE_FULL_DAYS} days so far. Years are scaled down until you reach {CONFIDENCE_FULL_DAYS} days.
                </p>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-hairline bg-surface/40 p-3 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>A lifestyle estimate from your habits, not a medical measurement of true biological age.</span>
      </div>

      {under18 && (
        <div className="flex items-start gap-2 rounded-xl border border-caution/40 bg-caution/10 p-3 text-[11px] text-caution">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>This feature was built with adults over 18 in mind. Because you're under 18 it's recommended <strong>not</strong> to use or rely on this estimate.</span>
        </div>
      )}

      {age == null ? (
        <div className="rounded-xl border border-hairline p-4 text-center text-sm text-muted-foreground">
          Add your age to estimate biological age.
          <button onClick={() => setAskAge(true)} className="mt-2 block w-full rounded-lg bg-sleep px-3 py-2 font-semibold text-background">Set your age</button>
        </div>
      ) : !result?.unlocked ? (
        <div className="space-y-2 rounded-xl border border-hairline p-4">
          <p className="text-sm font-semibold">Collecting data</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
            <div className="h-full bg-sleep" style={{ width: `${Math.min(100, ((result?.days || 0) / 28) * 100)}%` }} />
          </div>
          <CollectingChips
            days={result?.days || 0}
            factorCount={result?.factorCount || 0}
            factors={result?.factors || []}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {result.factors.map((f) => (
            <FactorRow key={f.id} factor={f} windowDays={result.days} />
          ))}
        </div>
      )}

      {result?.unlocked && <AiBubble result={result} />}

      <AgeDialog
        open={askAge}
        onClose={() => setAskAge(false)}
        onSubmit={(a) => { setAge(a); setLocalAge(a); setAskAge(false); }}
      />
    </Card>
  );
}
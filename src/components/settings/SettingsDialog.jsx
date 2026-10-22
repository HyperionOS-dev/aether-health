import { useEffect, useState } from "react";
import { Settings as SettingsIcon, Loader2, Check } from "lucide-react";
import { backend } from "@/api/backend";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import HeightField from "@/components/settings/HeightField";
import { useDemoMode, setDemoMode } from "@/hooks/useDemoMode";
import GeminiSection from "@/components/settings/GeminiSection";

export default function SettingsDialog() {
  const demo = useDemoMode();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [unit, setUnit] = useState("cm");
  const [weightKg, setWeightKg] = useState("");
  const [importedWeight, setImportedWeight] = useState(null);
  const [importLogIncludeTime, setImportLogIncludeTime] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError("");
    setSaved(false);
    (async () => {
      try {
        const me = await backend.me();
        const recent = await backend.entities.DailyMetric.filter({ created_by_id: me.id }, "-date", 60);
        if (!alive) return;
        setHeightCm(me.height_cm ?? "");
        setUnit(me.height_unit || "cm");
        setWeightKg(me.weight_kg ?? "");
        setImportLogIncludeTime(me.import_log_include_time === true);
        setImportedWeight(recent.find((d) => d.weight)?.weight ?? null);
      } catch (e) {
        if (alive) setError(e.response?.data?.error || e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await backend.updateMe({
        height_cm: heightCm === "" ? null : Number(heightCm),
        height_unit: unit,
        weight_kg: weightKg === "" ? null : Number(weightKg),
        import_log_include_time: importLogIncludeTime,
      });
      setSaved(true);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-hairline text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Settings"
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85svh] w-[calc(100vw_-_2rem)] max-w-md flex-col gap-0 overflow-hidden rounded-2xl border-hairline bg-card p-0">
        {/* Phone-first panel: a header and footer that stay put with one scrolling body in
            between. The panel is capped against the small viewport height, so it can never
            run off the top or bottom of a phone screen the way a centred block does. */}
        <DialogHeader className="shrink-0 space-y-1.5 border-b border-hairline px-5 pb-4 pr-14 pt-5 text-left">
          <DialogTitle className="font-display text-lg">Your profile</DialogTitle>
          <DialogDescription>
            Used to estimate the calories burned in sessions you log manually.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5">
              <HeightField cm={heightCm} unit={unit} onUnit={setUnit} onChange={setHeightCm} />
              <div className="space-y-2">
                <Label htmlFor="set-weight">Weight (kg)</Label>
                <Input
                  id="set-weight"
                  type="number"
                  inputMode="decimal"
                  placeholder={importedWeight ? String(importedWeight) : "e.g. 75"}
                  value={weightKg ?? ""}
                  onChange={(e) => setWeightKg(e.target.value === "" ? "" : Number(e.target.value))}
                  className="h-11 rounded-xl border-hairline bg-surface"
                />
                <p className="text-xs text-muted-foreground">
                  {importedWeight
                    ? `Imported from Huawei Health: ${importedWeight} kg. Leave empty to keep using it.`
                    : "Leave empty to keep using your latest imported weight."}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface/40 p-3">
                <div>
                  <Label htmlFor="import-time-toggle" className="text-sm">Show import time</Label>
                  <p className="text-xs text-muted-foreground">Include the time in names of future imports.</p>
                </div>
                <Switch
                  id="import-time-toggle"
                  checked={importLogIncludeTime}
                  onCheckedChange={setImportLogIncludeTime}
                  aria-label="Include time in future import names"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface/40 p-3">
                <div>
                  <Label htmlFor="demo-toggle" className="text-sm">Demo data</Label>
                  <p className="text-xs text-muted-foreground">Preview the dashboard with generated sample data instead of your sync.</p>
                </div>
                <Switch id="demo-toggle" checked={demo === "1"} onCheckedChange={(c) => setDemoMode(c ? "1" : null)} aria-label="Toggle demo data" />
              </div>
              <GeminiSection />
            </div>
            <div className="shrink-0 space-y-3 border-t border-hairline px-5 py-4">
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button onClick={save} disabled={busy} className="h-12 w-full rounded-xl bg-sleep text-background hover:bg-sleep/90">
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Saved
                  </>
                ) : (
                  "Save settings"
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, FileArchive, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { importGadgetbridgeFiles } from "@/lib/firebase/imports";
import { toast } from "@/components/ui/use-toast";

const FALLBACK_ZONES = ["Etc/UTC", "Asia/Riyadh", "Europe/London", "Europe/Berlin", "America/New_York", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];

export default function GadgetbridgeForm() {
  const detected = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC"; } catch { return "Etc/UTC"; }
  }, []);
  const zones = useMemo(() => [detected, ...FALLBACK_ZONES.filter((z) => z !== detected)], [detected]);
  const [zone, setZone] = useState(detected);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [summary, setSummary] = useState(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function run() {
    if (!files.length) return;
    setBusy(true); setError(""); setSummary(null);
    try {
      const result = await importGadgetbridgeFiles(files, zone, -new Date().getTimezoneOffset());
      setSummary({
        days: result.days || 0,
        workouts: result.workouts || 0,
        updated: result.updated || 0,
        cross: result.crossCheck,
      });
      const skipped = result.skippedDuplicates || [];
      if (skipped.length) {
        // Red, because a FIT file was not imported. The Toaster sits above the routes, so it survives the redirect below.
        toast({
          variant: "destructive",
          title: "FIT skipped as a duplicate",
          description: skipped.length === 1
            ? `${skipped[0].activity} at ${skipped[0].start_time} on ${skipped[0].date} matched a database workout within 2 minutes. The database version was kept.`
            : `${skipped.length} FIT workouts matched database workouts within 2 minutes. The database versions were kept.`,
        });
      }
      setFiles([]);
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["health"] });
    }
  }

  function addFiles(list) {
    const incoming = Array.from(list || []);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...incoming.filter((f) => !seen.has(f.name + f.size))];
    });
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>In Gadgetbridge, export the database — either the table files or the database file itself.</li>
        <li>Zip the table folder, or keep the database as it is — no need to open or edit either.</li>
        <li>Upload it here, with the timezone your watch records in.</li>
      </ol>
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Timezone of your watch data</label>
        <Select value={zone} onValueChange={setZone}>
          <SelectTrigger className="h-11 rounded-xl border-hairline bg-surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {zones.map((z) => (
              <SelectItem key={z} value={z}>{z === detected ? `${z} (this device)` : z}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Timestamps in the export are in UTC. This is the local timezone they get filed under, so nights land on the right day.
        </p>
      </div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors ${dragging ? "border-sleep bg-sleep/10" : "border-hairline bg-surface hover:border-sleep"}`}
      >
        <Upload className={`h-6 w-6 ${dragging ? "text-sleep" : "text-muted-foreground"}`} />
        <span className="text-sm font-medium">{dragging ? "Drop your export here" : "Choose or drag the export"}</span>
        <span className="text-xs text-muted-foreground">ZIP of table files, the database file, single CSV tables, or a FIT activity file</span>
        <input
          type="file"
          accept=".zip,.csv,.db,.fit"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </label>
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li key={f.name + f.size} className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-card px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <FileArchive className="h-4 w-4 shrink-0 text-sleep" />
                <span className="truncate">{f.name}</span>
              </span>
              <button onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-danger" aria-label="Remove file">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {summary && (
        <div className="space-y-1 rounded-xl border border-hairline bg-card p-3 text-sm">
          <p className="font-semibold text-sleep">
            Imported {summary.days} days and {summary.workouts} workouts{summary.updated ? `, updated ${summary.updated} existing days` : ""}.
          </p>
          {summary.cross && (
            <p className="text-xs text-muted-foreground">
              Load cross-check: your zone-based load reads {summary.cross.medianRatio}× the watch's own across {summary.cross.pairs} sessions.
            </p>
          )}
        </div>
      )}
      <Button onClick={run} disabled={!files.length || busy} className="h-12 w-full rounded-xl bg-sleep text-background hover:bg-sleep/90">
        {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Reading your export…</> : "Import Gadgetbridge export"}
      </Button>
    </div>
  );
}
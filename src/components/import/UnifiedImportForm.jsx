import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, FileJson, FileArchive, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { importHuaweiFiles, importGadgetbridgeFiles } from "@/lib/firebase/imports";
import { guessSource, zipEntryNames, HEAD_LENGTH, HUAWEI, GADGETBRIDGE } from "@/lib/importers/detectSource";
import { toast } from "@/components/ui/use-toast";

const FALLBACK_ZONES = ["Etc/UTC", "Asia/Riyadh", "Europe/London", "Europe/Berlin", "America/New_York", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];
const SOURCE_LABEL = { [HUAWEI]: "Huawei", [GADGETBRIDGE]: "Gadgetbridge" };

async function headOf(file) {
  return new Uint8Array(await file.slice(0, HEAD_LENGTH).arrayBuffer());
}

// Entry names of a zip, read from its directory only. Non-zip files give an empty list.
async function entryNamesOf(file) {
  if (!file.name.toLowerCase().endsWith(".zip")) return [];
  return zipEntryNames(file.size, async (start, end) =>
    new Uint8Array(await file.slice(start, end).arrayBuffer()),
  );
}

export default function UnifiedImportForm() {
  const detected = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC"; } catch { return "Etc/UTC"; }
  }, []);
  const zones = useMemo(() => [detected, ...FALLBACK_ZONES.filter((z) => z !== detected)], [detected]);
  const [zone, setZone] = useState(detected);
  // Each entry: { id, file, source }. The source is guessed on drop and can be switched by hand.
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [summary, setSummary] = useState(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const hasGadgetbridge = items.some((item) => item.source === GADGETBRIDGE);

  async function addFiles(list) {
    const incoming = Array.from(list || []);
    const accepted = [];
    const rejected = [];
    for (const file of incoming) {
      const source = guessSource(file.name, await headOf(file), await entryNamesOf(file));
      if (source) accepted.push({ id: file.name + file.size, file, source });
      else rejected.push(file.name);
    }
    setItems((prev) => {
      const seen = new Set(prev.map((item) => item.id));
      return [...prev, ...accepted.filter((item) => !seen.has(item.id))];
    });
    setError(rejected.length ? `Not a supported export: ${rejected.join(", ")}` : "");
  }

  function setSource(id, source) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, source } : item)));
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  // Each source runs through its own importer, which is unchanged. A failure in one source
  // does not stop the other, and a source that imported is cleared from the list.
  async function run() {
    if (!items.length) return;
    setBusy(true); setError(""); setSummary(null);
    const errors = [];
    const totals = { days: 0, workouts: 0, updated: 0 };
    let cross = null;
    try {
      const huawei = items.filter((item) => item.source === HUAWEI).map((item) => item.file);
      const gadgetbridge = items.filter((item) => item.source === GADGETBRIDGE).map((item) => item.file);
      if (huawei.length) {
        try {
          const result = await importHuaweiFiles(huawei);
          totals.days += result.days || 0;
          totals.workouts += result.workouts || 0;
          totals.updated += result.updated || 0;
          setItems((prev) => prev.filter((item) => item.source !== HUAWEI));
        } catch (e) {
          errors.push(`Huawei: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (gadgetbridge.length) {
        try {
          const result = await importGadgetbridgeFiles(gadgetbridge, zone, -new Date().getTimezoneOffset());
          totals.days += result.days || 0;
          totals.workouts += result.workouts || 0;
          totals.updated += result.updated || 0;
          cross = result.crossCheck || null;
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
          setItems((prev) => prev.filter((item) => item.source !== GADGETBRIDGE));
        } catch (e) {
          errors.push(`Gadgetbridge: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setSummary({ ...totals, cross });
      if (errors.length) setError(errors.join(" · "));
      else navigate("/");
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["health"] });
    }
  }

  return (
    <div className="min-w-0 space-y-4 overflow-hidden">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Huawei Health: Me → Privacy center → Request your data, then upload the CSVs, ZIPs or detail JSON files.</li>
        <li>Gadgetbridge: export the database (the table files, the database file, or a FIT activity).</li>
        <li>Drop everything here. Each file is matched to its source; switch it if the guess is wrong.</li>
      </ol>
      {hasGadgetbridge && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Timezone of your watch data (Gadgetbridge)</label>
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
      )}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors ${dragging ? "border-sleep bg-sleep/10" : "border-hairline bg-surface hover:border-sleep"}`}
      >
        <Upload className={`h-6 w-6 ${dragging ? "text-sleep" : "text-muted-foreground"}`} />
        <span className="text-sm font-medium">{dragging ? "Drop your files here" : "Choose or drag export files"}</span>
        <span className="text-xs text-muted-foreground">Huawei CSV, JSON or ZIP · Gadgetbridge ZIP, database or FIT</span>
        <input
          type="file"
          accept=".json,.csv,.zip,.db,.fit"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </label>
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-card px-3 py-2">
              <span className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                {item.source === HUAWEI ? <FileJson className="mt-0.5 h-4 w-4 shrink-0 text-sleep" /> : <FileArchive className="mt-0.5 h-4 w-4 shrink-0 text-sleep" />}
                <span className="min-w-0 break-all">{item.file.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <select
                  value={item.source}
                  onChange={(e) => setSource(item.id, e.target.value)}
                  aria-label={`Source for ${item.file.name}`}
                  className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs"
                >
                  <option value={HUAWEI}>{SOURCE_LABEL[HUAWEI]}</option>
                  <option value={GADGETBRIDGE}>{SOURCE_LABEL[GADGETBRIDGE]}</option>
                </select>
                <button onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-danger" aria-label="Remove file">
                  <X className="h-4 w-4" />
                </button>
              </span>
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
      <Button onClick={run} disabled={!items.length || busy} className="h-12 w-full rounded-xl bg-sleep text-background hover:bg-sleep/90">
        {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Reading your data...</> : `Import & calculate scores${items.length > 1 ? ` (${items.length} files)` : ""}`}
      </Button>
    </div>
  );
}

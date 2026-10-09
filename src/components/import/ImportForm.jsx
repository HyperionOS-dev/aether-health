import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, FileJson, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { importHuaweiFiles } from "@/lib/firebase/imports";

export default function ImportForm() {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function run() {
    if (!files.length) return;
    setBusy(true); setError(""); setResults([]); setSummary(null);
    try {
      const result = await importHuaweiFiles(files);
      setResults(result.files || []);
      setSummary({ days: result.days || 0, workouts: result.workouts || 0 });
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

  function removeAt(i) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>In Huawei Health, go to Me → Privacy center → Request your data.</li>
        <li>Download and unzip the file Huawei sends you.</li>
        <li>Upload Huawei metric CSVs, ZIPs of CSVs, or official Health detail JSON files containing heart-rate data.</li>
      </ol>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors ${dragging ? "border-sleep bg-sleep/10" : "border-hairline bg-surface hover:border-sleep"}`}
      >
        <Upload className={`h-6 w-6 ${dragging ? "text-sleep" : "text-muted-foreground"}`} />
        <span className="text-sm font-medium">{dragging ? "Drop your files here" : "Choose or drag export files"}</span>
        <span className="text-xs text-muted-foreground">CSV, JSON or ZIP; multiple allowed</span>
        <input
          type="file"
          accept=".json,.csv,.zip"
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
                <FileJson className="h-4 w-4 shrink-0 text-sleep" />
                <span className="truncate">{f.name}</span>
              </span>
              <button onClick={() => removeAt(i)} className="text-muted-foreground hover:text-danger" aria-label="Remove file">
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
            Imported {summary.days} days and {summary.workouts} workouts.
          </p>
          {results.map((r) => (
            <p key={r.name} className="text-xs text-muted-foreground">
              {r.name}: {r.days === 0 && r.workouts === 0 ? "no readable data" : `${r.days} days · ${r.workouts} workouts`}
            </p>
          ))}
        </div>
      )}
      <Button onClick={run} disabled={!files.length || busy} className="h-12 w-full rounded-xl bg-sleep text-background hover:bg-sleep/90">
        {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Reading your health data…</> : `Import & calculate scores${files.length > 1 ? ` (${files.length} files)` : ""}`}
      </Button>
    </div>
  );
}
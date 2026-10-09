import { useEffect, useMemo, useState } from "react";
import { Sparkles, KeyRound, Eye, EyeOff, Trash2, RefreshCw, Loader2, Settings2 } from "lucide-react";
import {
  buildPayload, payloadHash, callGemini, geminiSettings, localExplanation, friendlyError, MIN_CALL_GAP,
} from "@/lib/gemini";

export default function AiBubble({ result }) {
  const [showSettings, setShowSettings] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cache, setCache] = useState(() => geminiSettings.loadCache());
  const [lastCall, setLastCall] = useState(0);
  const [tick, setTick] = useState(0); // re-check key presence after settings

  const payload = useMemo(() => buildPayload(result), [result]);
  const hash = useMemo(() => payloadHash(payload), [payload]);
  const hasKey = useMemo(() => !!geminiSettings.getKey(), [tick, showSettings]);
  const local = useMemo(() => localExplanation(result), [result]);

  // No key (or failure) -> never empty: show the deterministic local explanation.
  useEffect(() => {
    if (!hasKey) { setText(local); setError(""); }
  }, [hasKey, local]);

  async function run(force) {
    if (!geminiSettings.getKey()) { setShowSettings(true); return; }
    if (!geminiSettings.isAcknowledged()) { setShowSettings(true); return; }
    if (!force && cache[hash]) { setText(cache[hash]); setError(""); return; }
    const now = Date.now();
    if (now - lastCall < MIN_CALL_GAP) {
      setError("Please wait a few seconds between requests.");
      return;
    }
    setLastCall(now);
    setLoading(true);
    setError("");
    try {
      const out = await callGemini(payload);
      setText(out);
      const next = { ...cache, [hash]: out };
      setCache(next);
      geminiSettings.saveCache(next);
    } catch (e) {
      const code = e?.name === "AbortError" ? "ABORTED" : e.message;
      setError(friendlyError(code));
      setText(local);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-hairline bg-surface/30 p-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sleep/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sleep">
          <Sparkles className="h-3 w-3" /> AI
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => run(false)} disabled={loading} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-surface" aria-label="Generate AI explanation">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => setShowSettings((s) => !s)} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-surface" aria-label="AI settings">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{text || local}</p>

      {!hasKey && (
        <button onClick={() => setShowSettings(true)} className="text-xs font-semibold text-sleep hover:underline">
          Add a Gemini key for a fuller explanation
        </button>
      )}
      {error && <p className="text-[11px] text-muted-foreground">{error}</p>}
      <p className="text-[10px] text-muted-foreground">Estimate for tracking trends, not medical advice.</p>

      {showSettings && (
        <KeySettings
          onClose={() => { setShowSettings(false); setTick((t) => t + 1); }}
          onSaved={() => { setShowSettings(false); setTick((t) => t + 1); if (geminiSettings.getKey()) run(true); }}
        />
      )}
    </div>
  );
}

function KeySettings({ onClose, onSaved }) {
  const [key, setKey] = useState(() => geminiSettings.getKey());
  const [model, setModel] = useState(() => geminiSettings.getModel());
  const [show, setShow] = useState(false);
  const [ack, setAck] = useState(() => geminiSettings.isAcknowledged());
  const existing = !!geminiSettings.getKey();

  function save() {
    geminiSettings.setKey(key.trim());
    geminiSettings.setModel(model.trim());
    if (ack) geminiSettings.acknowledge();
    onSaved();
  }
  function remove() {
    geminiSettings.setKey("");
    setKey("");
    onClose();
  }

  return (
    <div className="space-y-3 rounded-xl border border-hairline bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold"><KeyRound className="h-3.5 w-3.5" /> Gemini key (browser-only)</div>
      <div className="flex items-center gap-2">
        <input
          type={show ? "text" : "password"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste Gemini API key"
          className="h-9 flex-1 rounded-lg border border-hairline bg-surface px-2 text-sm"
        />
        <button onClick={() => setShow((s) => !s)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-hairline" aria-label="Toggle key visibility">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Model ID (default free-tier Flash)</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} className="h-9 w-full rounded-lg border border-hairline bg-surface px-2 text-sm" />
      </div>
      <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        <span>I understand: free Gemini keys may let Google use prompts to improve its products and humans may review them.</span>
      </label>
      <p className="text-[10px] text-muted-foreground">Stored only in this browser. Never sent to the app's backend or stored in the database.</p>
      <div className="flex gap-2">
        <button onClick={save} disabled={!ack || !key.trim()} className="flex-1 rounded-lg bg-sleep px-3 py-2 text-sm font-semibold text-background disabled:opacity-40">Save</button>
        {existing && (
          <button onClick={remove} className="flex items-center gap-1 rounded-lg border border-hairline px-3 py-2 text-sm text-danger">
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </div>
    </div>
  );
}
import { useEffect, useMemo, useState } from "react";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import {
  buildPayload, payloadHash, callGemini, geminiSettings, localExplanation, friendlyError, MIN_CALL_GAP,
} from "@/lib/gemini";

export default function AiBubble({ result }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cache, setCache] = useState(() => geminiSettings.loadCache());
  const [lastCall, setLastCall] = useState(0);
  const [enabled, setEnabled] = useState(() => geminiSettings.isEnabled());

  const payload = useMemo(() => buildPayload(result), [result]);
  const hash = useMemo(() => payloadHash(payload), [payload]);
  const local = useMemo(() => localExplanation(result), [result]);

  // Follow the Settings toggle and key changes live.
  useEffect(() => geminiSettings.subscribe(() => setEnabled(geminiSettings.isEnabled())), []);

  // Feature off (or no key) -> never empty: show the deterministic local explanation.
  useEffect(() => {
    if (!enabled) { setText(local); setError(""); }
  }, [enabled, local]);

  async function run(force) {
    if (!geminiSettings.isEnabled() || !geminiSettings.getKey()) {
      setError(friendlyError("NO_KEY"));
      return;
    }
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
        </div>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{text || local}</p>

      {!enabled && (
        <p className="text-xs text-muted-foreground">Turn on Gemini explanations in the Settings panel for a fuller explanation.</p>
      )}
      {error && <p className="text-[11px] text-muted-foreground">{error}</p>}
      <p className="text-[10px] text-muted-foreground">Estimate for tracking trends, not medical advice.</p>
    </div>
  );
}

import { useState } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { geminiSettings } from "@/lib/gemini";

// Gemini toggle for the settings panel. Turning it on shows the disclaimer first; the key is
// asked for only after the user accepts. Cancelling at any step leaves the feature off.
export default function GeminiSection() {
  const [enabled, setEnabled] = useState(() => geminiSettings.isEnabled());
  const [flow, setFlow] = useState(null); // null | "consent" | "key"

  function onToggle(on) {
    if (on) {
      setFlow("consent");
      return;
    }
    geminiSettings.setEnabled(false);
    setEnabled(false);
  }

  function onSaved() {
    setFlow(null);
    setEnabled(geminiSettings.isEnabled());
  }

  function remove() {
    geminiSettings.setKey("");
    geminiSettings.setEnabled(false);
    setEnabled(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-hairline bg-surface/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="gemini-toggle" className="text-sm">Gemini explanations</Label>
          <p className="text-xs text-muted-foreground">Optional AI wording for your Healthspan estimate. Off by default.</p>
        </div>
        <Switch id="gemini-toggle" checked={enabled} onCheckedChange={onToggle} aria-label="Toggle Gemini explanations" />
      </div>
      {enabled && (
        <div className="flex gap-2">
          <button onClick={() => setFlow("key")} className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm">
            Change key
          </button>
          <button onClick={remove} className="flex items-center gap-1 rounded-lg border border-hairline px-3 py-2 text-sm text-danger">
            <Trash2 className="h-3.5 w-3.5" /> Remove key
          </button>
        </div>
      )}

      <Dialog open={flow !== null} onOpenChange={(open) => { if (!open) setFlow(null); }}>
        <DialogContent className="max-w-md rounded-2xl border-hairline bg-card">
          {flow === "consent" ? (
            <ConsentStep onAccept={() => setFlow("key")} onCancel={() => setFlow(null)} />
          ) : (
            <KeyStep onSaved={onSaved} onCancel={() => setFlow(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KeyStep({ onSaved, onCancel }) {
  const [key, setKey] = useState(() => geminiSettings.getKey());
  const [model, setModel] = useState(() => geminiSettings.getModel());
  const [show, setShow] = useState(false);

  function save() {
    geminiSettings.setKey(key.trim());
    geminiSettings.setModel(model.trim());
    geminiSettings.acknowledge();
    geminiSettings.setEnabled(true);
    onSaved();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-lg">Gemini API key</DialogTitle>
        <DialogDescription>Paste your key to turn on Gemini explanations.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
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
          <Label htmlFor="gemini-model" className="text-[11px] text-muted-foreground">Model ID (default free-tier Flash)</Label>
          <input
            id="gemini-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-9 w-full rounded-lg border border-hairline bg-surface px-2 text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm">Cancel</button>
        <button onClick={save} disabled={!key.trim()} className="flex-1 rounded-lg bg-sleep px-3 py-2 text-sm font-semibold text-background disabled:opacity-40">
          Save and turn on
        </button>
      </div>
    </>
  );
}

function ConsentStep({ onAccept, onCancel }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-lg">Turn on Gemini explanations?</DialogTitle>
        <DialogDescription>Please read this before continuing.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>
          When on, a summary of your Healthspan estimate is sent to Google's Gemini: averages, a 7-day trend and a 30-day trend, with no dates or daily records. Free-tier keys may let Google use these prompts to improve its products, and humans may review them.
        </p>
        <p>
          This is a lifestyle estimate for tracking trends. It is not medical advice and does not measure your true biological age. Talk to a clinician about any health decision.
        </p>
        <p>Your API key is stored only in this browser. It is never sent to the app's backend or stored in the database.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-lg border border-hairline px-3 py-2 text-sm">Cancel</button>
        <button onClick={onAccept} className="flex-1 rounded-lg bg-sleep px-3 py-2 text-sm font-semibold text-background">I accept</button>
      </div>
    </>
  );
}

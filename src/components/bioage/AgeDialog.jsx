import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AgeDialog({ open, onClose, onSubmit }) {
  const [val, setVal] = useState("");
  useEffect(() => { if (open) setVal(""); }, [open]);

  const n = Number(val);
  const valid = Number.isInteger(n) && n > 0 && n < 120;
  const under18 = valid && n < 18;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl border-hairline bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Your age</DialogTitle>
          <DialogDescription>
            We use your integer age to compare your habits against health-guideline thresholds. Stored only in this browser.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="bio-age">Age (years)</Label>
            <Input
              id="bio-age"
              type="number"
              inputMode="numeric"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              className="h-11 rounded-xl border-hairline bg-surface"
            />
          </div>
          {under18 && (
            <div className="flex items-start gap-2 rounded-xl border border-caution/40 bg-caution/10 p-3 text-xs text-caution">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>This feature was built with adults over 18 and their bodies in mind. It's recommended <strong>not</strong> to use or rely on it below 18.</span>
            </div>
          )}
          <Button
            onClick={() => onSubmit(n)}
            disabled={!valid}
            className="h-11 w-full rounded-xl bg-sleep text-background hover:bg-sleep/90"
          >
            Save age
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
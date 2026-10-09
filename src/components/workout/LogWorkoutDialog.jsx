import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dumbbell, Loader2 } from "lucide-react";
import { backend } from "@/api/backend";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayStr } from "@/lib/metrics";

const ACTIVITIES = [
  "Walking", "Running", "Cycling", "Swimming", "Hiking", "Rowing", "Elliptical", "Stair Climbing",
  "Strength Training", "HIIT", "CrossFit", "Yoga", "Pilates", "Stretching", "Dancing", "Boxing",
  "Martial Arts", "Football", "Basketball", "Tennis", "Badminton", "Squash", "Table Tennis",
  "Climbing", "Skiing", "Ice Skating", "Golf", "Jump Rope", "Other",
];

export default function LogWorkoutDialog() {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [activity, setActivity] = useState("Walking");
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const qc = useQueryClient();

  async function save() {
    setBusy(true);
    setError("");
    try {
      await backend.logWorkout({ date, activity, duration_min: Number(minutes) });
      qc.invalidateQueries({ queryKey: ["health"] });
      setMinutes("");
      setOpen(false);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-11 rounded-xl border-hairline bg-card px-4 text-xs font-semibold uppercase tracking-[1.5px] hover:bg-surface"
        >
          <Dumbbell className="mr-2 h-4 w-4 text-sleep" />
          Log workout
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md rounded-2xl border-hairline bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Log a workout</DialogTitle>
          <DialogDescription>
            Add a session your watch didn't capture. Calories are estimated from your body weight.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wo-date">Date</Label>
            <Input
              id="wo-date"
              type="date"
              max={todayStr()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 rounded-xl border-hairline bg-surface"
            />
          </div>
          <div className="space-y-2">
            <Label>Activity</Label>
            <Select value={activity} onValueChange={setActivity}>
              <SelectTrigger className="h-11 rounded-xl border-hairline bg-surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {ACTIVITIES.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wo-min">Duration (minutes)</Label>
            <Input
              id="wo-min"
              type="number"
              inputMode="numeric"
              placeholder="45"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="h-11 rounded-xl border-hairline bg-surface"
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button
            onClick={save}
            disabled={busy || !minutes}
            className="h-12 w-full rounded-xl bg-sleep text-background hover:bg-sleep/90"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save workout"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
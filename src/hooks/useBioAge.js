import { useMemo, useCallback } from "react";
import { computeBioAge, bioAgeSnapshot } from "@/lib/bioAge";

const AGE_KEY = "aether.bioage.age";
const SNAP_KEY = "aether.bioage.snapshots";

export function getAge() {
  const v = localStorage.getItem(AGE_KEY);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function setAge(a) {
  localStorage.setItem(AGE_KEY, String(a));
}

export function loadSnapshots() {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) || "{}"); } catch { return {}; }
}

function saveSnapshots(map) {
  const keys = Object.keys(map).sort();
  const trimmed = keys.slice(-30).reduce((o, k) => { o[k] = map[k]; return o; }, {});
  localStorage.setItem(SNAP_KEY, JSON.stringify(trimmed));
}

export function useBioAge(metrics, workouts, age) {
  const result = useMemo(
    () => (age != null ? computeBioAge({ metrics, workouts, age }) : null),
    [metrics, workouts, age],
  );

  const recordSnapshot = useCallback(() => {
    if (!result) return;
    const snap = bioAgeSnapshot(result);
    const map = loadSnapshots();
    map[snap.date] = snap;
    saveSnapshots(map);
  }, [result]);

  return { result, recordSnapshot };
}
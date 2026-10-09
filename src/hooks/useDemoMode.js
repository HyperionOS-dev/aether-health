import { useSyncExternalStore } from "react";
import { getDemoMode, subscribeDemoMode, setDemoMode } from "@/lib/demoState";

// Reactive demo-mode flag. Components read this; the settings panel writes via
// setDemoMode. Returns "1" | "sparse" | null.
export function useDemoMode() {
  return useSyncExternalStore(subscribeDemoMode, getDemoMode, () => null);
}

export { setDemoMode };
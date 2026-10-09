// Demo mode lives in localStorage and is toggled from the settings panel (no URL
// param). A tiny external store keeps every consumer (useHealthData, TopBar,
// BioAgeCard, SettingsDialog) in sync reactively.
const KEY = "aether.demo.mode";
let mode = load();

function load() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "1" || v === "sparse") return v;
  } catch {
    /* no localStorage */
  }
  return null;
}

const listeners = new Set();

export function getDemoMode() {
  return mode;
}

export function setDemoMode(next) {
  const v = next === "1" || next === "sparse" ? next : null;
  mode = v;
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(mode));
}

export function subscribeDemoMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
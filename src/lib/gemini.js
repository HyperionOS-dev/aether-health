// Browser-only Gemini call for the Biological Age AI bubble. The API key lives ONLY
// in localStorage — never in an entity/DB, never sent to the app's backend, never in
// a URL, log, or error message. Calls go straight to Google's REST endpoint with the
// x-goog-api-key header.
//
// Endpoint: the stable :generateContent REST path (documented and CORS-enabled).
// Default model: gemini-3.8-flash (current free-tier Flash; editable in settings).

import { BIO_AGE_CONFIG_VERSION } from "./bioAgeConfig";

const KEY_STORE = "aether.bioage.geminiKey";
const MODEL_STORE = "aether.bioage.geminiModel";
const ACK_STORE = "aether.bioage.privacyAck";
const DEFAULT_MODEL = "gemini-3.8-flash";
// v3: bumped with the 3-bullet prompt and the trend/rank payload, so replies written under the
// old prompt are never served for the new one. (v2 cleared the old truncated-reply cache.)
const CACHE_STORE = "aether.bioage.aiCache.v3";
const MIN_CALL_GAP_MS = 10000;

const endpoint = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

export const geminiSettings = {
  getKey: () => localStorage.getItem(KEY_STORE) || "",
  setKey: (k) => (k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE)),
  getModel: () => localStorage.getItem(MODEL_STORE) || DEFAULT_MODEL,
  setModel: (m) => localStorage.setItem(MODEL_STORE, m || DEFAULT_MODEL),
  isAcknowledged: () => localStorage.getItem(ACK_STORE) === "1",
  acknowledge: () => localStorage.setItem(ACK_STORE, "1"),
  loadCache: () => {
    try { return JSON.parse(localStorage.getItem(CACHE_STORE) || "{}"); } catch { return {}; }
  },
  saveCache: (c) => localStorage.setItem(CACHE_STORE, JSON.stringify(c)),
};

export const MIN_CALL_GAP = MIN_CALL_GAP_MS;

// Privacy-safe payload: integer age, window length, factor aggregates only. Each factor
// carries its window average, a 7-day average and direction, a 30-day average, rank, and
// target. No dates, raw HR streams, per-day rows, workout names, name, or birth year.
export function buildPayload(result) {
  return {
    configVersion: BIO_AGE_CONFIG_VERSION,
    age: Math.round(result.age),
    windowDays: result.days,
    confidence: Math.round(result.confidence * 100) / 100,
    totalYears: result.totalYears,
    factors: result.factors
      .filter((f) => !f.excluded)
      .map((f) => ({
        label: f.label,
        rank: f.rank,
        value: f.value != null ? Math.round(f.value * 100) / 100 : null,
        unit: f.unit,
        target: f.target,
        years: f.yearsShown,
        last7: f.recent7 ? Math.round(f.recent7.value * 100) / 100 : null,
        last7Direction: f.recent7?.direction ?? null,
        last30: f.trend ? Math.round(f.trend.last30 * 100) / 100 : null,
      })),
  };
}

export function payloadHash(payload) {
  const s = JSON.stringify(payload);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

const SYSTEM_PROMPT =
  "You explain a lifestyle-based biological-age estimate from the JSON provided. " +
  "Reply with exactly 3 short bullets, plain language, under 120 words total: " +
  "(1) what is working and why, citing a factor's value; " +
  "(2) the one change with the most impact, targeting the rank-1 drag and its last7 or last30 trend; " +
  "(3) how to measure that change next week, using the same factor. " +
  "Use the numbers in the JSON for the user. You may cite well-established general reference ranges " +
  "(for example adult sleep 7-9 hours), but never introduce any other new number about the user. " +
  "Do not restate the years values, since the app already shows them. " +
  "Never diagnose, never give medical advice, and never claim to measure true biological age.";

export async function callGemini(payload, { signal } = {}) {
  const key = geminiSettings.getKey();
  const model = geminiSettings.getModel();
  if (!key) throw new Error("NO_KEY");
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("OFFLINE");

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: JSON.stringify(payload) }] }],
    // max_output_tokens counts thinking tokens plus visible text, so a small cap truncates replies.
    // the reply (surfaced as TRUNCATED). 4096 leaves ample headroom for the <=110-word answer.
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  };

  let res;
  // 503 = Google temporarily overloaded; retry once after a short pause before falling back.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      res = await fetch(endpoint(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      // A fetch failure while online is typically a CORS/network block.
      throw new Error(navigator.onLine === false ? "OFFLINE" : "BLOCKED");
    }
    if (res.status !== 503 || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (res.status === 429) throw new Error("QUOTA");
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error("INVALID_KEY");
  if (!res.ok) throw new Error("HTTP_" + res.status);

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  // Never show a cut-off sentence: a MAX_TOKENS stop falls back to the local estimate.
  if (candidate?.finishReason === "MAX_TOKENS") throw new Error("TRUNCATED");
  const text = (candidate?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("EMPTY");
  return text;
}

// Deterministic local explanation from the factor table — shown when there is no key
// or the call fails, so the bubble is never empty.
export function localExplanation(result) {
  const active = result.factors.filter((f) => !f.excluded && f.yearsShown != null);
  if (!active.length) return "Not enough factors yet to explain. Keep syncing your health data.";
  const help = [...active].sort((a, b) => a.yearsShown - b.yearsShown)[0];
  const drag = [...active].sort((a, b) => b.yearsShown - a.yearsShown)[0];
  const fmt = (n) => (Math.abs(n) < 0.05 ? "0.0" : (n > 0 ? "+" : "") + n.toFixed(1));
  const parts = [];
  if (help.yearsShown < -0.05) parts.push(`Biggest help: ${help.label.toLowerCase()} (${fmt(help.yearsShown)} yrs)`);
  if (drag.yearsShown > 0.05) parts.push(`Biggest drag: ${drag.label.toLowerCase()} (${fmt(drag.yearsShown)} yrs)`);
  if (drag.yearsShown > 0.05 && DRAG_TIPS[drag.id]) parts.push(DRAG_TIPS[drag.id]);
  if (!parts.length) parts.push("All measured factors are near their targets — keep it up.");
  return parts.join(". ") + ".";
}

const DRAG_TIPS = {
  sleep: "Try a consistent 7-9h bedtime window",
  consistency: "Anchor a fixed wake time, even on weekends",
  rhr: "Add easy aerobic work and prioritise recovery sleep",
  steps: "Build up a daily walk to raise your step count",
  activity: "Add one brisk session this week toward 150 min",
};

export function friendlyError(code) {
  switch (code) {
    case "NO_KEY": return "Add a Gemini key for a fuller explanation.";
    case "OFFLINE": return "You're offline — showing a local estimate.";
    case "QUOTA": return "Gemini quota reached (429) — showing a local estimate.";
    case "INVALID_KEY": return "Gemini rejected the key — showing a local estimate.";
    case "BLOCKED": return "Gemini blocked this browser request (CORS/network) — showing a local estimate.";
    case "EMPTY": return "Gemini returned no text — showing a local estimate.";
    case "TRUNCATED": return "Gemini's reply was cut short — showing a local estimate.";
    default: return `Couldn't reach Gemini (${code || "unknown"}) — showing a local estimate.`;
  }
}
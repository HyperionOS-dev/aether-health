import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeBioAge } from "./bioAge";
import { buildPayload } from "./gemini";

// 180 days at the EARLY values, with the last 7 days at `late`.
function days({ early, late }) {
  const out = [];
  for (let i = 0; i < 180; i++) {
    const v = i >= 173 ? late : early;
    out.push({
      sleep_hours: v.sleep,
      sleep_consistency: v.consistency,
      resting_hr: v.rhr,
      steps: v.steps,
      hr_covered: false,
    });
  }
  return out;
}

const EARLY = { sleep: 7, consistency: 70, rhr: 65, steps: 6000 };
const LATE_WORSE = { sleep: 6, consistency: 55, rhr: 75, steps: 4000 };
const LATE_BETTER = { sleep: 8.5, consistency: 90, rhr: 58, steps: 9500 };

describe("recent7 direction", () => {
  test("a 7-day move away from target reads as worsening", () => {
    const r = computeBioAge({ metrics: days({ early: EARLY, late: LATE_WORSE }), workouts: [], age: 40 });
    const sleep = r.factors.find((f) => f.id === "sleep");
    assert.equal(sleep.recent7.direction, "worsening");
    assert.equal(sleep.recent7.value, 6);
  });

  test("a 7-day move toward target reads as improving, including lower-is-better RHR", () => {
    const r = computeBioAge({ metrics: days({ early: EARLY, late: LATE_BETTER }), workouts: [], age: 40 });
    assert.equal(r.factors.find((f) => f.id === "sleep").recent7.direction, "improving");
    assert.equal(r.factors.find((f) => f.id === "rhr").recent7.direction, "improving");
  });

  test("no change inside the 3% dead band reads as stable", () => {
    const r = computeBioAge({ metrics: days({ early: EARLY, late: EARLY }), workouts: [], age: 40 });
    for (const f of r.factors.filter((x) => !x.excluded && x.recent7)) {
      assert.equal(f.recent7.direction, "stable", f.id);
    }
  });
});

describe("rank", () => {
  test("rank 1 is the biggest drag, and excluded factors have no rank", () => {
    const r = computeBioAge({ metrics: days({ early: EARLY, late: LATE_WORSE }), workouts: [], age: 40 });
    const active = r.factors.filter((f) => !f.excluded);
    const top = active.find((f) => f.rank === 1);
    assert.ok(top, "one factor is ranked first");
    for (const f of active) {
      assert.ok(top.yearsShown >= f.yearsShown, `${top.id} should be the biggest drag`);
    }
    for (const f of r.factors.filter((x) => x.excluded)) assert.equal(f.rank, null);
  });
});

describe("buildPayload", () => {
  test("carries last7, direction and rank per factor, and no dates or per-day rows", () => {
    const r = computeBioAge({ metrics: days({ early: EARLY, late: LATE_WORSE }), workouts: [], age: 40 });
    const p = buildPayload(r);
    const json = JSON.stringify(p);
    assert.match(json, /"last7Direction":"(improving|worsening|stable)"/);
    assert.ok(p.factors.every((f) => "rank" in f && "last7" in f && "last30" in f));
    assert.doesNotMatch(json, /\d{4}-\d{2}-\d{2}/, "no dates");
    assert.doesNotMatch(json, /"date"|"metrics"|"workouts"/, "no per-day rows");
  });
});

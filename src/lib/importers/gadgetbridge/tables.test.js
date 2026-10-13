// The one place every timestamp column is normalised, so the inputs that matter are pinned here:
// a value already in milliseconds, a value in seconds, and the junk values the importer must drop
// rather than file under 1970.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { timestampMs } from "./tables.ts";

describe("timestampMs", () => {
  test("a value already in milliseconds is returned unchanged", () => {
    assert.equal(timestampMs("1772928000000"), 1772928000000);
  });

  test("a value in seconds is scaled to milliseconds", () => {
    assert.equal(timestampMs("1772928000"), 1772928000000);
  });

  test("zero is not a timestamp and stays NaN, so no 1970 day is filed", () => {
    assert.ok(Number.isNaN(timestampMs("0")));
  });

  test("a negative number is not a timestamp and stays NaN", () => {
    assert.ok(Number.isNaN(timestampMs("-29740")));
  });
});

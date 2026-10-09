import { describe, it, expect } from "vitest";
import {
  intensityOf,
  levelFor,
  percentile,
  absoluteIntensity,
  HEATMAP_CONFIG,
} from "./heatmapScale";

describe("percentile", () => {
  it("linear interpolation at p90", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 5);
  });

  it("empty window is 0", () => {
    expect(percentile([], 0.9)).toBe(0);
  });
});

describe("adaptive heatmap intensity", () => {
  it("mixed window (half ~14-18, half ~1), d = 2.5 -> L1", () => {
    const win = [...Array(8).fill(1), ...Array(8).fill(16)];
    const { intensity } = intensityOf(2.5, win);
    expect(levelFor(intensity)).toBe("L1");
  });

  it("near-zero window with a few <=1.5, d = 3 -> at least L2", () => {
    const win = [...Array(20).fill(0), 1, 1.5];
    const { intensity } = intensityOf(3, win);
    expect(["L2", "L3", "L4"]).toContain(levelFor(intensity));
  });

  it("day >= max(p90, FLOOR) with full confidence -> L4", () => {
    const win = Array(30).fill(5); // p90 = 5, denom = max(5, 6) = 6
    const { intensity } = intensityOf(6, win);
    expect(levelFor(intensity)).toBe("L4");
  });

  it("n < 7 uses absolute only", () => {
    const win = [20, 20]; // n = 2
    const { intensity } = intensityOf(2, win);
    expect(intensity).toBeCloseTo(absoluteIntensity(2), 5);
    expect(intensity).toBeCloseTo(2 / HEATMAP_CONFIG.maxStrain, 5);
  });

  it("the trailing window never includes the day itself (handled by caller)", () => {
    // Pure function receives an already-filtered window; verify a window that
    // excludes the day yields a stable, <1 intensity.
    const win = Array(15).fill(8);
    const { intensity } = intensityOf(8, win);
    expect(intensity).toBeLessThanOrEqual(1);
    expect(intensity).toBeGreaterThanOrEqual(0);
  });
});
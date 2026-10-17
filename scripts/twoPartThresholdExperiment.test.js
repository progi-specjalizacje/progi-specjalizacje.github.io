import test from "node:test";
import assert from "node:assert/strict";
import {
  assignSegment,
  empiricalQuantile,
  intervalSummary,
  residualInterval,
} from "./twoPartThresholdExperiment.js";

test("segment uses the fill probability known before the round", () => {
  assert.equal(assignSegment(0.79), "ryzyko_zalamania_progu");
  assert.equal(assignSegment(0.8), "konkurencyjna");
  assert.equal(assignSegment(null), "konkurencyjna");
  assert.equal(assignSegment(0.65, 0.6), "konkurencyjna");
});

test("interval falls back to pooled residuals when a segment is small", () => {
  const pooled = Array.from({ length: 21 }, (_, index) => index - 10);
  const small = [-30, 30];
  const interval = residualInterval(small, pooled);
  assert.equal(interval.pooled, true);
  assert.equal(interval.lower, empiricalQuantile(pooled, 0.1));
  assert.equal(residualInterval([], [1, 2]), null);
});

test("interval summary counts coverage only for rows with an interval", () => {
  const rows = [
    { rzeczywisty_prog: 80, lower: 78, upper: 82 },
    { rzeczywisty_prog: 70, lower: 78, upper: 82 },
    { rzeczywisty_prog: 80, lower: null, upper: null },
  ];
  assert.deepEqual(intervalSummary(rows, "lower", "upper"), { n: 2, coverage: 0.5, mean_width: 4 });
});

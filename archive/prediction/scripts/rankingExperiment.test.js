import { test } from "node:test";
import assert from "node:assert/strict";
import { rankScores, selectHistory } from "./rankingExperiment.js";

test("ties preserve exact top-10/20% mass and equal percentiles", () => {
  for (const scores of [[100, 90, 90, 80, 70], [80, 80, 80], [90], Array.from({ length: 100 }, (_, i) => i)]) {
    const ranks = rankScores(scores);
    for (const [field, fraction] of [["top10", 0.1], ["top20", 0.2]]) {
      assert(Math.abs(scores.reduce((sum, score) => sum + ranks.get(score)[field], 0) - scores.length * fraction) < 1e-9);
    }
    assert(scores.every((score) => ranks.get(score).percentile >= 0 && ranks.get(score).percentile <= 100));
  }
  assert.equal(rankScores([80, 80, 80]).get(80).percentile, 50);
});

test("history excludes current/future outcomes and prefers the same season", () => {
  const rounds = ["w-2023", "j-2023", "w-2024", "j-2024"];
  const order = new Map(rounds.map((name, i) => [name, i]));
  const rows = rounds.map((rekrutacja) => ({ rekrutacja, sezon: rekrutacja[0], dziedzina_medycyny: "A", wojewodztwo: "B" }));
  const snapshots = new Map(rows.map((row) => [`${row.rekrutacja}::A::B`, {}]));
  assert.equal(selectHistory(rows[0], rows, snapshots, order), undefined);
  assert.equal(selectHistory(rows[1], rows, snapshots, order), rows[0]);
  assert.equal(selectHistory(rows[2], rows, snapshots, order), rows[0]);
  assert.equal(selectHistory(rows[2], rows.slice(0, 2), snapshots, order), rows[0]);
  snapshots.delete("w-2023::A::B");
  assert.equal(selectHistory(rows[2], rows, snapshots, order), rows[1]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { macroMae, selectFocusedVariant } from "./focusedThresholdModel.js";

test("macro MAE gives small specialties equal weight", () => {
  const rows = [
    ...Array.from({ length: 100 }, () => ({ dziedzina_medycyny: "large", rzeczywisty_prog: 80, prediction: 81 })),
    { dziedzina_medycyny: "small", rzeczywisty_prog: 80, prediction: 85 },
  ];
  assert.equal(macroMae(rows, "prediction"), 3);
});

test("selection requires two completed validation rounds and retains baseline on ties", () => {
  const row = { dziedzina_medycyny: "A", rzeczywisty_prog: 80, production: 85, focused: 80, blend: 82.5 };
  assert.equal(selectFocusedVariant([]), "production");
  assert.equal(selectFocusedVariant([{ ...row, rekrutacja: "j-2024" }]), "production");
  const prior = ["j-2024", "w-2025"].map((rekrutacja) => ({ ...row, rekrutacja }));
  assert.equal(selectFocusedVariant(prior), "focused");
  assert.equal(selectFocusedVariant(prior.map((r) => ({ ...r, production: 80 }))), "production");
});

import assert from "node:assert/strict";
import path from "node:path";

export const FOCUSED_SPECIALTIES = [
  "Chirurgia plastyczna", "Dermatologia i wenerologia", "Endokrynologia",
  "Gastroenterologia", "Neurochirurgia", "Psychiatria",
  "Psychiatria dzieci i młodzieży", "Anestezjologia i intensywna terapia",
  "Ortodoncja", "Chirurgia stomatologiczna",
];

// Each specialty receives equal weight regardless of its number of regional pools.
export function macroMae(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const values = groups.get(row.dziedzina_medycyny) ?? [];
    values.push(Math.abs(row[field] - row.rzeczywisty_prog));
    groups.set(row.dziedzina_medycyny, values);
  }
  const means = [...groups.values()].map((values) => values.reduce((a, b) => a + b, 0) / values.length);
  return means.length ? means.reduce((a, b) => a + b, 0) / means.length : null;
}

export function selectFocusedVariant(prior) {
  if (new Set(prior.map((row) => row.rekrutacja)).size < 2) return "production";
  return ["production", "focused", "blend"].reduce((best, name) =>
    macroMae(prior, name) < macroMae(prior, best) ? name : best, "production");
}

export function runFocusedThresholdModel({ root, rows, roundOrder, testRounds, forecastRound,
  fitRidge, baseFeatures, isCompetitiveTarget, backtestRows, forecasts, writeCsv, metrics, round }) {
  const inScope = (row) => FOCUSED_SPECIALTIES.includes(row.dziedzina_medycyny);
  const index = new Map(roundOrder.map((name, i) => [name, i]));
  const key = (row) => [row.rekrutacja, row.dziedzina_medycyny, row.wojewodztwo].join("::");
  const production = new Map([...backtestRows, ...forecasts].map((row) => [key(row), row]));
  const evaluated = [];
  const future = [];
  const selections = [];
  for (const testRound of [...testRounds, forecastRound]) {
    const training = rows.filter((row) => inScope(row) && isCompetitiveTarget(row) && index.get(row.rekrutacja) < index.get(testRound));
    assert(training.length > 0);
    const model = fitRidge(training, baseFeatures);
    const prior = evaluated.filter((row) => index.get(row.rekrutacja) < index.get(testRound));
    const selected = selectFocusedVariant(prior);
    selections.push({ round: testRound, selected, validation_rounds: [...new Set(prior.map((row) => row.rekrutacja))], training_rows: training.length });
    const targets = rows.filter((row) => inScope(row) && row.rekrutacja === testRound &&
      (testRound === forecastRound ? Number(row.oferowane_miejsca_rezydenckie) > 0 :
        isCompetitiveTarget(row) && row.liczba_historycznych_pelnych_pul >= 1));
    for (const row of targets) {
      const reference = production.get(key(row));
      assert(reference, `Missing matched reference: ${key(row)}`);
      const predictions = { production: Number(reference.prognoza_model_trend_delta_laczony ?? reference.prognoza_trend_delta_laczony), focused: model.predict(row) };
      predictions.blend = (predictions.production + predictions.focused) / 2;
      assert(Object.values(predictions).every(Number.isFinite));
      const result = {
        rekrutacja: testRound, dziedzina_medycyny: row.dziedzina_medycyny, wojewodztwo: row.wojewodztwo,
        ...Object.fromEntries(Object.entries(predictions).map(([name, value]) => [name, round(value)])),
        selected_variant: selected, selected: round(predictions[selected]),
      };
      if (testRound === forecastRound) {
        const probability = Number(reference.prawdopodobienstwo_pelnej_puli_surowe);
        assert(Number.isFinite(probability) && probability >= 0 && probability <= 1);
        future.push({ ...result, prawdopodobienstwo_pelnej_puli: probability,
          historyczne_pelne_pule: row.liczba_historycznych_pelnych_pul,
          status: row.liczba_historycznych_pelnych_pul >= 1 ? "eksperymentalny_prog_warunkowy_pelnej_puli" : "ekstrapolacja_brak_historycznego_progu" });
      } else evaluated.push({ ...result, rzeczywisty_prog: row.target });
    }
  }
  const summarize = (data) => data.length ? Object.fromEntries(["production", "focused", "blend", "selected"].map((name) =>
    [name, { ...metrics(data, name), macro_mae: round(macroMae(data, name)) }])) : null;
  const coverage = FOCUSED_SPECIALTIES.map((name) => {
    const historical = rows.filter((row) => row.dziedzina_medycyny === name && index.get(row.rekrutacja) < index.get(forecastRound));
    const tested = evaluated.filter((row) => row.dziedzina_medycyny === name);
    return { specialty: name, historical_rows: historical.length, competitive_rows: historical.filter(isCompetitiveTarget).length,
      forecast_rows: future.filter((row) => row.dziedzina_medycyny === name).length,
      metrics: summarize(tested), status: historical.length ? (tested.length ? "oceniona" : "brak_progów_do_oceny") : "brak_danych" };
  });
  for (const [filename, data] of [["focused_threshold_backtest.csv", evaluated], [`focused_threshold_forecast_${forecastRound}.csv`, future]]) {
    assert(data.length > 0);
    writeCsv(path.join(root, "prediction/data", filename), data, Object.keys(data[0]));
  }
  const summary = summarize(evaluated);
  return { version: "focused-v2", status: "experimental_production_unchanged", specialties: FOCUSED_SPECIALTIES,
    objective: "Regional macro MAE: equal specialty weights; conditional on full pools, with prior competitive history.",
    candidates: { production: "Existing 60/20/20 ensemble", focused: "Ridge lambda 20 trained only on requested specialties, existing historical base features", blend: "Fixed 50/50 production and focused" },
    selection: "Choose using strictly earlier out-of-fold rounds, minimum two rounds; otherwise production. Shared selection across specialties.",
    selections, overall: summary, coverage,
    by_round: Object.fromEntries(testRounds.map((name) => [name, summarize(evaluated.filter((row) => row.rekrutacja === name))])),
    promotion_eligible_on_macro_mae: summary.selected.macro_mae <= summary.production.macro_mae,
    limitations: ["Exploratory reuse of historical data; needs prospective validation.", "No claim of improvement for specialties without evaluable full pools.", "Existing fill model remains separate and unchanged; national thresholds are not this target.", "Historical feature summaries retain information from other specialties; only fitted training targets are restricted."] };
}

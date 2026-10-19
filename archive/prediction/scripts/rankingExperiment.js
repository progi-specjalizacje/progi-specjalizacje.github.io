import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const key = (row) => [row.rekrutacja, row.dziedzina_medycyny, row.wojewodztwo].join("::");
const profileFeatures = ["hist_q25", "hist_mediana", "hist_iqr"];
const positionFeatures = ["hist_percentyl_min", "hist_percentyl_mediana"];
const shareFeatures = ["hist_udzial_top10", "hist_udzial_top20", "hist_koncentracja_top10", "hist_koncentracja_top20"];
const rankFeatures = [...positionFeatures, ...shareFeatures];
const hierarchyFeatures = ["hierarchical_anchor_fixed"];

export function selectHistory(row, rows, snapshots, order) {
  const prior = rows.filter((other) => order.get(other.rekrutacja) < order.get(row.rekrutacja)
    && other.dziedzina_medycyny === row.dziedzina_medycyny && other.wojewodztwo === row.wojewodztwo
    && snapshots.has(key(other))).sort((a, b) => order.get(a.rekrutacja) - order.get(b.rekrutacja));
  return prior.filter((other) => other.sezon === row.sezon).at(-1) ?? prior.at(-1);
}

// Fractional membership prevents arbitrary ordering of equal scores at a top-k boundary.
export function rankScores(scores) {
  const sorted = [...scores].sort((a, b) => b - a);
  const ranks = new Map();
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end] === sorted[start]) end++;
    ranks.set(sorted[start], {
      percentile: 100 * (sorted.length - (start + end) / 2) / sorted.length,
      top10: Math.max(0, Math.min(end, sorted.length * 0.1) - start) / (end - start),
      top20: Math.max(0, Math.min(end, sorted.length * 0.2) - start) / (end - start),
    });
    start = end;
  }
  return ranks;
}

export function runRankingExperiment(ctx) {
  const { root, rows, rawRows, readCsv, numeric, quantile, mean, round, groupBy,
    fitRidge, baseFeatures, roundOrder, testRounds, isCompetitiveTarget,
    backtestRows, nationalEvaluation, estimateFullProbability, weightedMean,
    writeCsv, metrics, forecastRound } = ctx;
  const order = new Map(roundOrder.map((name, i) => [name, i]));
  const specialtyExam = new Map(rawRows.map((row) => [row.dziedzina_medycyny, row.egzamin]));
  const candidates = [];
  const seen = new Map();
  let duplicates = 0;
  for (const file of fs.readdirSync(path.join(root, "source_data")).filter((name) => name.endsWith("_parsed.csv")).sort()) {
    for (const row of readCsv(path.join(root, "source_data", file))) {
      const exam = specialtyExam.get(row.dziedzina_medycyny);
      if (row.tryb_szkolenia !== "Rezydencki" || row.czy_miejsca_doktoranckie === "TAK" || !exam) continue;
      assert(order.has(row.rekrutacja), "Unknown recruitment round");
      const score = numeric(row.punktacja_proc);
      assert(score !== null && score >= 0 && score <= 100, "Invalid ranking score");
      assert(row.numer_wniosku, "Missing application identifier");
      const id = `${row.rekrutacja}::${row.numer_wniosku}`;
      const signature = `${key(row)}::${score}`;
      if (seen.has(id)) {
        assert.equal(seen.get(id), signature, "Conflicting duplicate application");
        duplicates++;
        continue;
      }
      seen.set(id, signature);
      candidates.push({ ...row, score, egzamin: exam });
    }
  }
  const snapshots = new Map();
  for (const pool of groupBy(candidates, (row) => `${row.rekrutacja}::${row.egzamin}`).values()) {
    const ranks = rankScores(pool.map((row) => row.score));
    for (const specialty of groupBy(pool, (row) => row.dziedzina_medycyny).values()) {
      const top10 = specialty.reduce((sum, row) => sum + ranks.get(row.score).top10, 0);
      const top20 = specialty.reduce((sum, row) => sum + ranks.get(row.score).top20, 0);
      for (const cell of groupBy(specialty, (row) => row.wojewodztwo).values()) {
        const scores = cell.map((row) => row.score);
        const percentiles = scores.map((score) => ranks.get(score).percentile);
        snapshots.set(key(cell[0]), {
          hist_q25: quantile(scores, 0.25), hist_mediana: quantile(scores, 0.5),
          hist_iqr: quantile(scores, 0.75) - quantile(scores, 0.25),
          hist_percentyl_min: Math.min(...percentiles), hist_percentyl_mediana: quantile(percentiles, 0.5),
          hist_udzial_top10: top10 / (pool.length * 0.1), hist_udzial_top20: top20 / (pool.length * 0.2),
          hist_koncentracja_top10: top10 / specialty.length, hist_koncentracja_top20: top20 / specialty.length,
        });
      }
    }
  }
  const variants = {
    profile: profileFeatures,
    positions: positionFeatures,
    shares: shareFeatures,
    ranking: rankFeatures,
    combined: [...profileFeatures, ...rankFeatures],
    hierarchy: hierarchyFeatures,
    hierarchy_shares: [...hierarchyFeatures, ...shareFeatures],
  };
  const features = rows.map((row) => {
    const source = selectHistory(row, rows, snapshots, order);
    if (source) assert(order.get(source.rekrutacja) < order.get(row.rekrutacja));
    const priorCompetitiveSpecialty = rows.filter((other) =>
      order.get(other.rekrutacja) < order.get(row.rekrutacja)
      && other.dziedzina_medycyny === row.dziedzina_medycyny
      && isCompetitiveTarget(other));
    const globalMean = numeric(row.sredni_prog_globalny_przed_runda);
    const specialtyMean = numeric(row.sredni_prog_specjalizacji_przed_runda) ?? globalMean;
    const cellMean = numeric(row.sredni_historyczny_prog_konkurencyjny) ?? specialtyMean;
    const specialtyCount = priorCompetitiveSpecialty.length;
    const cellCount = numeric(row.liczba_historycznych_pelnych_pul) ?? 0;
    const specialtyAnchor = globalMean === null
      ? specialtyMean
      : (specialtyCount * specialtyMean + 8 * globalMean) / (specialtyCount + 8);
    const hierarchicalAnchor = specialtyAnchor === null
      ? globalMean
      : (cellCount * cellMean + 3 * specialtyAnchor) / (cellCount + 3);
    return {
      ...row,
      ...snapshots.get(source ? key(source) : ""),
      ranking_source_round: source?.rekrutacja ?? "",
      hierarchical_anchor_fixed: hierarchicalAnchor,
    };
  });
  const regional = [];
  const national = [];
  const baselineIndex = new Map(backtestRows.map((row) => [key(row), row]));
  for (const testRound of testRounds) {
    const train = features.filter((row) => order.get(row.rekrutacja) < order.get(testRound) && isCompetitiveTarget(row));
    const models = Object.fromEntries(Object.entries(variants).map(([name, fields]) => [name, fitRidge(train, [...baseFeatures, ...fields])]));
    const predict = (row) => Object.fromEntries(Object.entries(models).map(([name, model]) => [`prediction_${name}`, round(model.predict(row))]));
    for (const row of features.filter((row) => row.rekrutacja === testRound && baselineIndex.has(key(row)))) {
      const baseline = baselineIndex.get(key(row));
      regional.push({ rekrutacja: testRound, dziedzina_medycyny: row.dziedzina_medycyny, wojewodztwo: row.wojewodztwo,
        egzamin: row.egzamin, ranking_source_round: row.ranking_source_round,
        scisly_stabilny_przed_runda: baseline.scisly_stabilny_przed_runda,
        rzeczywisty_prog: baseline.rzeczywisty_prog,
        prediction_base: baseline.prognoza_model_bez_egzaminu,
        prediction_production: baseline.prognoza_model_trend_delta_laczony, ...predict(row) });
    }
    for (const baseline of nationalEvaluation.filter((row) => row.rekrutacja === testRound)) {
      const offered = features.filter((row) => row.rekrutacja === testRound && row.dziedzina_medycyny === baseline.dziedzina_medycyny && numeric(row.oferowane_miejsca_rezydenckie) > 0);
      const prior = rawRows.filter((row) => order.get(row.rekrutacja) < order.get(testRound));
      const weights = offered.map((row) => estimateFullProbability(row, prior));
      const predictions = offered.map(predict);
      national.push({ rekrutacja: testRound, dziedzina_medycyny: baseline.dziedzina_medycyny,
        rzeczywisty_prog: baseline.rzeczywisty_prog,
        prediction_base: baseline.empiryczna_wazona_prognoza_model_bez_egzaminu,
        prediction_production: baseline.empiryczna_wazona_prognoza_model_trend_delta_laczony,
        ...Object.fromEntries(Object.keys(variants).map((name) => [`prediction_${name}`, round(weightedMean(predictions.map((row) => row[`prediction_${name}`]), weights))])) });
    }
  }
  assert.equal(regional.length, backtestRows.length);
  assert.equal(national.length, nationalEvaluation.length);
  const fields = ["base", "production", ...Object.keys(variants)];
  const summarize = (data) => Object.fromEntries(fields.map((name) => {
    assert(data.every((row) => Number.isFinite(row.rzeczywisty_prog) && Number.isFinite(row[`prediction_${name}`])));
    return [name, metrics(data, `prediction_${name}`)];
  }));
  const specialtyDiagnostics = [...groupBy(national, (row) => row.dziedzina_medycyny)]
    .map(([specialty, specialtyRows]) => {
      const productionErrors = specialtyRows.map((row) => Math.abs(row.prediction_production - row.rzeczywisty_prog));
      const rankingErrors = specialtyRows.map((row) => Math.abs(row.prediction_ranking - row.rzeczywisty_prog));
      return {
        dziedzina_medycyny: specialty,
        liczba_rund: specialtyRows.length,
        mae_produkcja: round(mean(productionErrors)),
        mae_ranking: round(mean(rankingErrors)),
        poprawa_mae_ranking_minus_produkcja: round(mean(productionErrors) - mean(rankingErrors)),
        rundy_wygrane_ranking: rankingErrors.filter((error, index) => error < productionErrors[index]).length,
        rundy_remis: rankingErrors.filter((error, index) => error === productionErrors[index]).length,
        rundy_przegrane_ranking: rankingErrors.filter((error, index) => error > productionErrors[index]).length,
      };
    })
    .sort((a, b) => b.poprawa_mae_ranking_minus_produkcja - a.poprawa_mae_ranking_minus_produkcja);
  const pairedNational = {
    rows_improved: national.filter((row) => Math.abs(row.prediction_ranking - row.rzeczywisty_prog) < Math.abs(row.prediction_production - row.rzeczywisty_prog)).length,
    rows_tied: national.filter((row) => Math.abs(row.prediction_ranking - row.rzeczywisty_prog) === Math.abs(row.prediction_production - row.rzeczywisty_prog)).length,
    rows_worsened: national.filter((row) => Math.abs(row.prediction_ranking - row.rzeczywisty_prog) > Math.abs(row.prediction_production - row.rzeczywisty_prog)).length,
    specialties_improved: specialtyDiagnostics.filter((row) => row.poprawa_mae_ranking_minus_produkcja > 0).length,
    specialties_tied: specialtyDiagnostics.filter((row) => row.poprawa_mae_ranking_minus_produkcja === 0).length,
    specialties_worsened: specialtyDiagnostics.filter((row) => row.poprawa_mae_ranking_minus_produkcja < 0).length,
    specialties_total: specialtyDiagnostics.length,
  };
  const overallNationalGain = metrics(national, "prediction_production").mae - metrics(national, "prediction_ranking").mae;
  const leaveOneSpecialtyOut = specialtyDiagnostics.map((diagnostic) => {
    const retained = national.filter((row) => row.dziedzina_medycyny !== diagnostic.dziedzina_medycyny);
    return {
      excluded_specialty: diagnostic.dziedzina_medycyny,
      n: retained.length,
      mae_gain_ranking_over_production:
        round(metrics(retained, "prediction_production").mae - metrics(retained, "prediction_ranking").mae),
    };
  });
  pairedNational.mae_gain_ranking_over_production = round(overallNationalGain);
  pairedNational.leave_one_specialty_out_min_gain = Math.min(...leaveOneSpecialtyOut.map((row) => row.mae_gain_ranking_over_production));
  pairedNational.leave_one_specialty_out_max_gain = Math.max(...leaveOneSpecialtyOut.map((row) => row.mae_gain_ranking_over_production));
  pairedNational.leave_one_specialty_out_all_positive = leaveOneSpecialtyOut.every((row) => row.mae_gain_ranking_over_production > 0);
  const shadowTrainingRows = features.filter((row) => order.get(row.rekrutacja) < order.get(forecastRound) && isCompetitiveTarget(row));
  const shadowModel = fitRidge(shadowTrainingRows, [...baseFeatures, ...shareFeatures]);
  const shadowFutureRows = features.filter((row) => row.rekrutacja === forecastRound && numeric(row.oferowane_miejsca_rezydenckie) > 0);
  const shadowPriorRows = rawRows.filter((row) => order.get(row.rekrutacja) < order.get(forecastRound));
  const shadowForecast = [...groupBy(shadowFutureRows, (row) => row.dziedzina_medycyny)].map(([specialty, specialtyRows]) => {
    const regionalPredictions = specialtyRows.map((row) => shadowModel.predict(row));
    const weights = specialtyRows.map((row) => estimateFullProbability(row, shadowPriorRows));
    return {
      frozen_at: "2026-09-23",
      model_version: "ranking-shares-v1",
      rekrutacja: forecastRound,
      dziedzina_medycyny: specialty,
      egzamin: specialtyRows[0].egzamin,
      regiony_z_oferta: specialtyRows.length,
      prognoza_krajowa_ranking_shares_proc: round(weightedMean(regionalPredictions, weights)),
      status: "shadow_do_oceny_po_publikacji_wynikow",
    };
  }).sort((a, b) => b.prognoza_krajowa_ranking_shares_proc - a.prognoza_krajowa_ranking_shares_proc);
  for (const [name, data] of [["regional", regional], ["national", national]]) {
    writeCsv(path.join(root, "prediction/data", `ranking_experiment_${name}_backtest.csv`), data, Object.keys(data[0]));
  }
  writeCsv(path.join(root, "prediction/data/ranking_experiment_features.csv"), features,
    ["rekrutacja", "dziedzina_medycyny", "wojewodztwo", "ranking_source_round", ...variants.combined, "hierarchical_anchor_fixed"]);
  writeCsv(path.join(root, "prediction/data/ranking_experiment_specialty_diagnostics.csv"), specialtyDiagnostics,
    Object.keys(specialtyDiagnostics[0]));
  writeCsv(path.join(root, `prediction/data/ranking_shadow_forecast_${forecastRound}.csv`), shadowForecast,
    Object.keys(shadowForecast[0]));
  return {
    status: "experimental_only_production_unchanged", candidates: candidates.length, identical_duplicates_removed: duplicates,
    feature_variants: variants, lambda: 20,
    hierarchical_anchor: "Fixed partial pooling: specialty mean shrunk toward the global mean with prior weight 8, then cell mean toward that specialty anchor with prior weight 3. Weights specified before evaluation and not tuned.",
    history_rule: "Latest observed same-season cell; fallback latest observed cell. Strictly earlier rounds only.",
    percentile_definition: "Midrank percentile among accepted residents in the same round and LEK/LDEK path; higher is better. Fractional top-10/20% membership for ties.",
    regional: summarize(regional), national: summarize(national), paired_national: pairedNational,
    national_by_specialty: specialtyDiagnostics,
    national_leave_one_specialty_out: leaveOneSpecialtyOut,
    frozen_shadow_forecast: {
      frozen_at: "2026-09-23",
      model_version: "ranking-shares-v1",
      forecast_round: forecastRound,
      feature_variant: "shares",
      specialties: shadowForecast.length,
      output: `prediction/data/ranking_shadow_forecast_${forecastRound}.csv`,
      production_unchanged: true,
    },
    regional_stable: summarize(regional.filter((row) => row.scisly_stabilny_przed_runda === "TAK")),
    by_exam: Object.fromEntries(["LEK", "LDEK"].map((exam) => [exam, summarize(regional.filter((row) => row.egzamin === exam))])),
    by_round: Object.fromEntries(testRounds.map((name) => [name, {
      regional: summarize(regional.filter((row) => row.rekrutacja === name)),
      national: summarize(national.filter((row) => row.rekrutacja === name)),
    }])),
    limitations: ["Accepted candidates only, not preferences or all applicants.", "Four evaluation rounds; exploratory comparison without hyperparameter tuning.", "National evaluation retains the existing conditional high-fill subset.", "National specialty shares use the same historical snapshot as the regional cell; missing cells are training-mean imputed."],
  };
}

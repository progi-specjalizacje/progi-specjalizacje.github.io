import path from "node:path";

const SUPPLY_VARIANTS = {
  current_context: [
    "log_miejsca_kraj_specjalizacja",
    "liczba_wojewodztw_z_oferta_specjalizacja",
    "zmiana_miejsc_kraj_specjalizacja",
    "udzial_miejsc_wojewodztwa_w_specjalizacji",
  ],
  relative_to_history: [
    "log_relacja_miejsc_kraj_do_typowych",
    "log_relacja_miejsc_komorka_do_typowych",
  ],
  combined: [
    "log_miejsca_kraj_specjalizacja",
    "liczba_wojewodztw_z_oferta_specjalizacja",
    "zmiana_miejsc_kraj_specjalizacja",
    "udzial_miejsc_wojewodztwa_w_specjalizacji",
    "log_relacja_miejsc_kraj_do_typowych",
    "log_relacja_miejsc_komorka_do_typowych",
  ],
};

const key = (row) => `${row.rekrutacja}::${row.dziedzina_medycyny}::${row.wojewodztwo}`;

function pairedCounts(rows, leftField, rightField) {
  return rows.reduce(
    (result, row) => {
      const left = Math.abs(row[leftField] - row.rzeczywisty_prog);
      const right = Math.abs(row[rightField] - row.rzeczywisty_prog);
      if (Math.abs(left - right) < 1e-9) result.tied += 1;
      else if (left < right) result.improved += 1;
      else result.worsened += 1;
      return result;
    },
    { improved: 0, tied: 0, worsened: 0 },
  );
}

export function runSupplyScaleExperiment({
  root,
  rows,
  roundOrder,
  testRounds,
  forecastRound,
  fitRidge,
  baseFeatures,
  isCompetitiveTarget,
  backtestRows,
  forecasts,
  writeCsv,
  metrics,
  round,
  numeric,
}) {
  const dataDir = path.join(root, "prediction", "data");
  const backtestFile = path.join(dataDir, "supply_scale_threshold_backtest.csv");
  const forecastFile = path.join(dataDir, `supply_scale_shadow_forecast_${forecastRound}.csv`);
  const roundIndex = new Map(roundOrder.map((name, index) => [name, index]));
  const productionIndex = new Map(backtestRows.map((row) => [key(row), row]));
  const experimentRows = [];

  for (const testRound of testRounds) {
    const testIndex = roundIndex.get(testRound);
    const trainRows = rows.filter(
      (row) => roundIndex.get(row.rekrutacja) < testIndex && isCompetitiveTarget(row),
    );
    const testRows = rows.filter(
      (row) =>
        row.rekrutacja === testRound &&
        isCompetitiveTarget(row) &&
        numeric(row.liczba_historycznych_pelnych_pul) >= 1,
    );
    if (!trainRows.length || !testRows.length) continue;

    const baseline = fitRidge(trainRows, baseFeatures);
    const models = Object.fromEntries(
      Object.entries(SUPPLY_VARIANTS).map(([name, features]) => [
        name,
        fitRidge(trainRows, [...baseFeatures, ...features]),
      ]),
    );

    for (const row of testRows) {
      const production = productionIndex.get(key(row));
      const productionPrediction = numeric(production?.prognoza_model_trend_delta_laczony);
      const combinedPrediction = models.combined.predict(row);
      experimentRows.push({
        rekrutacja: testRound,
        wojewodztwo: row.wojewodztwo,
        dziedzina_medycyny: row.dziedzina_medycyny,
        egzamin: row.egzamin,
        liczba_miejsc: row.oferowane_miejsca_rezydenckie,
        miejsca_kraj_specjalizacja: Math.expm1(row.log_miejsca_kraj_specjalizacja),
        typowe_miejsca_kraj_specjalizacja_przed_runda:
          row.typowe_miejsca_kraj_specjalizacja_przed_runda,
        relacja_miejsc_kraj_do_typowych:
          row.typowe_miejsca_kraj_specjalizacja_przed_runda === null
            ? null
            : Math.exp(row.log_relacja_miejsc_kraj_do_typowych),
        udzial_miejsc_wojewodztwa_w_specjalizacji:
          row.udzial_miejsc_wojewodztwa_w_specjalizacji,
        typowe_miejsca_komorka_przed_runda: row.typowe_miejsca_komorka_przed_runda,
        relacja_miejsc_komorka_do_typowych:
          row.log_relacja_miejsc_komorka_do_typowych === null
            ? null
            : Math.exp(row.log_relacja_miejsc_komorka_do_typowych),
        rzeczywisty_prog: row.target,
        prognoza_bazowa: baseline.predict(row),
        prognoza_produkcyjna: productionPrediction,
        prognoza_current_context: models.current_context.predict(row),
        prognoza_relative_to_history: models.relative_to_history.predict(row),
        prognoza_combined: combinedPrediction,
        prognoza_blend_produkcja_supply_50_50:
          (productionPrediction + combinedPrediction) / 2,
      });
    }
  }

  const numericOutputFields = [
    "miejsca_kraj_specjalizacja",
    "typowe_miejsca_kraj_specjalizacja_przed_runda",
    "relacja_miejsc_kraj_do_typowych",
    "udzial_miejsc_wojewodztwa_w_specjalizacji",
    "typowe_miejsca_komorka_przed_runda",
    "relacja_miejsc_komorka_do_typowych",
    "rzeczywisty_prog",
    "prognoza_bazowa",
    "prognoza_produkcyjna",
    "prognoza_current_context",
    "prognoza_relative_to_history",
    "prognoza_combined",
    "prognoza_blend_produkcja_supply_50_50",
  ];
  const roundedRows = experimentRows.map((row) => ({
    ...row,
    ...Object.fromEntries(numericOutputFields.map((field) => [field, round(row[field], 6)])),
  }));
  writeCsv(backtestFile, roundedRows, [
    "rekrutacja",
    "wojewodztwo",
    "dziedzina_medycyny",
    "egzamin",
    "liczba_miejsc",
    ...numericOutputFields.filter((field) => field !== "rzeczywisty_prog"),
    "rzeczywisty_prog",
  ]);

  const historicalTrainingRows = rows.filter(
    (row) => roundIndex.get(row.rekrutacja) < roundIndex.get(forecastRound) && isCompetitiveTarget(row),
  );
  const futureRows = rows.filter(
    (row) => row.rekrutacja === forecastRound && row.status_konkurencyjnosci === "wynik_niedostepny",
  );
  const finalModels = Object.fromEntries(
    Object.entries(SUPPLY_VARIANTS).map(([name, features]) => [
      name,
      fitRidge(historicalTrainingRows, [...baseFeatures, ...features]),
    ]),
  );
  const productionForecastIndex = new Map(forecasts.map((row) => [key(row), row]));
  const shadowForecast = futureRows.map((row) => {
    const productionPrediction = numeric(productionForecastIndex.get(key(row))?.prognoza_modelowa);
    const combinedPrediction = finalModels.combined.predict(row);
    return {
      rekrutacja: forecastRound,
      wojewodztwo: row.wojewodztwo,
      dziedzina_medycyny: row.dziedzina_medycyny,
      liczba_miejsc: row.oferowane_miejsca_rezydenckie,
      miejsca_kraj_specjalizacja: round(Math.expm1(row.log_miejsca_kraj_specjalizacja)),
      typowe_miejsca_kraj_specjalizacja_przed_runda: round(
        row.typowe_miejsca_kraj_specjalizacja_przed_runda,
      ),
      relacja_miejsc_kraj_do_typowych: round(
        row.typowe_miejsca_kraj_specjalizacja_przed_runda === null
          ? null
          : Math.exp(row.log_relacja_miejsc_kraj_do_typowych),
        6,
      ),
      udzial_miejsc_wojewodztwa_w_specjalizacji: round(
        row.udzial_miejsc_wojewodztwa_w_specjalizacji,
        6,
      ),
      prognoza_produkcyjna: productionPrediction,
      prognoza_current_context: round(finalModels.current_context.predict(row)),
      prognoza_relative_to_history: round(finalModels.relative_to_history.predict(row)),
      prognoza_combined: round(combinedPrediction),
      prognoza_blend_produkcja_supply_50_50: round(
        (productionPrediction + combinedPrediction) / 2,
      ),
      status: "shadow_do_oceny_po_publikacji_wynikow",
    };
  });
  writeCsv(forecastFile, shadowForecast, Object.keys(shadowForecast[0] ?? {}));

  const fields = {
    baseline: "prognoza_bazowa",
    production: "prognoza_produkcyjna",
    current_context: "prognoza_current_context",
    relative_to_history: "prognoza_relative_to_history",
    combined: "prognoza_combined",
    production_supply_blend_50_50: "prognoza_blend_produkcja_supply_50_50",
  };
  const variantMetrics = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [name, metrics(roundedRows, field)]),
  );
  const experimentalNames = Object.keys(SUPPLY_VARIANTS);
  const bestVariant = experimentalNames.reduce((best, name) =>
    variantMetrics[name].mae < variantMetrics[best].mae ? name : best,
  );

  return {
    status: "diagnostyczny; nie zmienia wariantu produkcyjnego",
    question: "Czy ta sama liczba miejsc ma inne znaczenie zależnie od typowej skali specjalizacji i komórki wojewódzkiej?",
    validation: "rolling-origin; identyczne regionalne progi jak w głównym backteście",
    rows: roundedRows.length,
    feature_variants: SUPPLY_VARIANTS,
    relative_feature_definition: "log((bieżące miejsca + 1) / (mediana miejsc we wcześniejszych rundach tej samej specjalizacji lub komórki + 1))",
    posthoc_blend_note: "Średnia 50/50 obecnego ensemble i najlepszego wariantu podaży została sprawdzona po obejrzeniu wyników wariantów; pozostaje shadow i wymaga niezależnej oceny na nowej rundzie.",
    variants: variantMetrics,
    best_variant: bestVariant,
    best_overall_variant: "production_supply_blend_50_50",
    paired_vs_baseline: pairedCounts(roundedRows, fields[bestVariant], fields.baseline),
    paired_vs_production: pairedCounts(roundedRows, fields[bestVariant], fields.production),
    blend_paired_vs_production: pairedCounts(
      roundedRows,
      fields.production_supply_blend_50_50,
      fields.production,
    ),
    by_round: Object.fromEntries(
      testRounds.map((roundName) => {
        const roundRows = roundedRows.filter((row) => row.rekrutacja === roundName);
        return [
          roundName,
          Object.fromEntries(
            Object.entries(fields).map(([name, field]) => [name, metrics(roundRows, field)]),
          ),
        ];
      }),
    ),
    by_exam: Object.fromEntries(
      ["LEK", "LDEK"].map((exam) => {
        const examRows = roundedRows.filter((row) => row.egzamin === exam);
        return [
          exam,
          Object.fromEntries(
            Object.entries(fields).map(([name, field]) => [name, metrics(examRows, field)]),
          ),
        ];
      }),
    ),
    frozen_shadow_forecast: {
      round: forecastRound,
      rows: shadowForecast.length,
      output: path.relative(root, forecastFile).replaceAll("\\", "/"),
      production_unchanged: true,
    },
    outputs: {
      backtest: path.relative(root, backtestFile).replaceAll("\\", "/"),
      forecast: path.relative(root, forecastFile).replaceAll("\\", "/"),
    },
  };
}

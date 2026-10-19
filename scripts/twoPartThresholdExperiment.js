import path from "node:path";

// Pule z niską szansą pełnego obsadzenia (z modelu zapełnienia uczonego tylko na
// wcześniejszych rundach) są traktowane jako zagrożone załamaniem progu.
// Próg 0,8 wybrano po diagnostyce błędów obecnego backtestu, więc wynik jest
// eksploracyjny; pozostałe progi są raportowane wyłącznie jako analiza wrażliwości.
export const RISK_PROBABILITY_THRESHOLD = 0.8;
export const SENSITIVITY_THRESHOLDS = [0.6, 0.7, 0.8, 0.9];
const MIN_RISK_TRAINING_ROWS = 40;
const MIN_INTERVAL_RESIDUALS = 20;
const INTERVAL_QUANTILES = [0.1, 0.9];

const SUPPLY_FEATURES = [
  "log_miejsca_kraj_specjalizacja",
  "liczba_wojewodztw_z_oferta_specjalizacja",
  "zmiana_miejsc_kraj_specjalizacja",
  "udzial_miejsc_wojewodztwa_w_specjalizacji",
  "log_relacja_miejsc_kraj_do_typowych",
  "log_relacja_miejsc_komorka_do_typowych",
];
const GATE_FEATURE = "logit_szansa_pelnej_puli";

const key = (row) => `${row.rekrutacja}::${row.dziedzina_medycyny}::${row.wojewodztwo}`;

export function assignSegment(probability, threshold = RISK_PROBABILITY_THRESHOLD) {
  if (!Number.isFinite(probability)) return "konkurencyjna";
  return probability < threshold ? "ryzyko_zalamania_progu" : "konkurencyjna";
}

export function empiricalQuantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

// Przedział z reszt (rzeczywisty - prognoza) wyłącznie z wcześniejszych rund
// backtestu. Gdy segment ma za mało reszt, używa reszt ze wszystkich segmentów.
export function residualInterval(segmentResiduals, pooledResiduals) {
  const source =
    segmentResiduals.length >= MIN_INTERVAL_RESIDUALS ? segmentResiduals : pooledResiduals;
  if (source.length < MIN_INTERVAL_RESIDUALS) return null;
  return {
    lower: empiricalQuantile(source, INTERVAL_QUANTILES[0]),
    upper: empiricalQuantile(source, INTERVAL_QUANTILES[1]),
    pooled: source !== segmentResiduals,
  };
}

export function intervalSummary(rows, lowerField, upperField) {
  const evaluated = rows.filter(
    (row) => Number.isFinite(row[lowerField]) && Number.isFinite(row[upperField]),
  );
  if (!evaluated.length) return { n: 0, coverage: null, mean_width: null };
  const covered = evaluated.filter(
    (row) => row.rzeczywisty_prog >= row[lowerField] && row.rzeczywisty_prog <= row[upperField],
  );
  const widths = evaluated.map((row) => row[upperField] - row[lowerField]);
  return {
    n: evaluated.length,
    coverage: covered.length / evaluated.length,
    mean_width: widths.reduce((sum, value) => sum + value, 0) / widths.length,
  };
}

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

export function runTwoPartThresholdExperiment({
  root,
  rows,
  roundOrder,
  testRounds,
  forecastRound,
  fitRidge,
  baseFeatures,
  isCompetitiveTarget,
  fillModelsByRound,
  backtestRows,
  forecasts,
  writeCsv,
  metrics,
  round,
  numeric,
}) {
  const dataDir = path.join(root, "prediction", "data");
  const backtestFile = path.join(dataDir, "two_part_threshold_backtest.csv");
  const forecastFile = path.join(dataDir, `two_part_shadow_forecast_${forecastRound}.csv`);
  const roundIndex = new Map(roundOrder.map((name, index) => [name, index]));
  const productionIndex = new Map(backtestRows.map((row) => [key(row), row]));
  const riskFeatures = [...baseFeatures, GATE_FEATURE, ...SUPPLY_FEATURES];
  const gateFeatures = [...baseFeatures, GATE_FEATURE];

  // Szansa zapełnienia każdej obserwacji pochodzi z modelu uczonego wyłącznie na
  // rundach wcześniejszych niż jej własna; dwie pierwsze rundy nie mają takiej wartości.
  const enriched = rows.map((row) => {
    const model = fillModelsByRound.get(row.rekrutacja);
    const probability = model ? model.predict(row) : null;
    const bounded = probability === null ? null : Math.min(Math.max(probability, 1e-4), 1 - 1e-4);
    return {
      ...row,
      szansa_pelnej_puli_przed_runda: probability,
      [GATE_FEATURE]: bounded === null ? null : Math.log(bounded / (1 - bounded)),
    };
  });

  function fitModels(trainRows, threshold) {
    // Cecha szansy jest uczona tylko na rundach, w których była znana przed rundą;
    // uzupełnianie brakującej szansy średnią zniekształcało współczynnik.
    const withProbability = trainRows.filter((row) =>
      Number.isFinite(row.szansa_pelnej_puli_przed_runda),
    );
    const gate =
      withProbability.length >= MIN_RISK_TRAINING_ROWS ? fitRidge(withProbability, gateFeatures) : null;
    const riskTrainRows = withProbability.filter(
      (row) => row.szansa_pelnej_puli_przed_runda < threshold,
    );
    const risk =
      riskTrainRows.length >= MIN_RISK_TRAINING_ROWS ? fitRidge(riskTrainRows, riskFeatures) : null;
    return { gate, risk, gateTrainingRows: withProbability.length, riskTrainingRows: riskTrainRows.length };
  }

  function predictRow(row, models, productionPrediction, threshold) {
    const probability = row.szansa_pelnej_puli_przed_runda;
    const segment = assignSegment(probability, threshold);
    const gatePrediction = models.gate ? models.gate.predict(row) : productionPrediction;
    const riskPrediction = models.risk ? models.risk.predict(row) : productionPrediction;
    const segmented = segment === "konkurencyjna" ? productionPrediction : riskPrediction;
    const weight = Number.isFinite(probability) ? probability : 1;
    return {
      segment,
      probability,
      gatePrediction,
      riskPrediction,
      segmented,
      soft: weight * productionPrediction + (1 - weight) * riskPrediction,
      riskFallback: !models.risk,
    };
  }

  const experimentRows = [];
  const foldInfo = [];
  const sensitivity = Object.fromEntries(SENSITIVITY_THRESHOLDS.map((value) => [value, []]));

  for (const testRound of testRounds) {
    const testIndex = roundIndex.get(testRound);
    const trainRows = enriched.filter(
      (row) => roundIndex.get(row.rekrutacja) < testIndex && isCompetitiveTarget(row),
    );
    const testRows = enriched.filter(
      (row) =>
        row.rekrutacja === testRound &&
        isCompetitiveTarget(row) &&
        numeric(row.liczba_historycznych_pelnych_pul) >= 1 &&
        productionIndex.has(key(row)),
    );
    if (!trainRows.length || !testRows.length) continue;

    const models = fitModels(trainRows, RISK_PROBABILITY_THRESHOLD);
    foldInfo.push({
      round: testRound,
      training_rows: trainRows.length,
      risk_training_rows: models.riskTrainingRows,
      gate_training_rows: models.gateTrainingRows,
      risk_model_fallback_to_production: !models.risk,
    });

    const earlier = experimentRows.filter((row) => roundIndex.get(row.rekrutacja) < testIndex);
    const pooledProduction = earlier.map((row) => row.rzeczywisty_prog - row.prognoza_produkcyjna);
    const pooledSegmented = earlier.map((row) => row.rzeczywisty_prog - row.prognoza_dwuczesciowa);

    for (const row of testRows) {
      const production = productionIndex.get(key(row));
      const productionPrediction = numeric(production.prognoza_model_trend_delta_laczony);
      const prediction = predictRow(row, models, productionPrediction, RISK_PROBABILITY_THRESHOLD);
      const segmentResiduals = earlier
        .filter((candidate) => candidate.segment === prediction.segment)
        .map((candidate) => candidate.rzeczywisty_prog - candidate.prognoza_dwuczesciowa);
      const productionInterval = residualInterval(pooledProduction, pooledProduction);
      const productionSegmentInterval = residualInterval(
        earlier
          .filter((candidate) => candidate.segment === prediction.segment)
          .map((candidate) => candidate.rzeczywisty_prog - candidate.prognoza_produkcyjna),
        pooledProduction,
      );
      const segmentedInterval = residualInterval(segmentResiduals, pooledSegmented);
      experimentRows.push({
        rekrutacja: testRound,
        wojewodztwo: row.wojewodztwo,
        dziedzina_medycyny: row.dziedzina_medycyny,
        egzamin: row.egzamin,
        liczba_miejsc: row.oferowane_miejsca_rezydenckie,
        szansa_pelnej_puli_przed_runda: prediction.probability,
        segment: prediction.segment,
        model_ryzyka_zastepczy: prediction.riskFallback ? "TAK" : "NIE",
        rzeczywisty_prog: row.target,
        prognoza_bazowa: numeric(production.prognoza_model_bez_egzaminu),
        prognoza_produkcyjna: productionPrediction,
        prognoza_z_szansa_zapelnienia: prediction.gatePrediction,
        prognoza_modelu_ryzyka: prediction.riskPrediction,
        prognoza_dwuczesciowa: prediction.segmented,
        prognoza_mieszanina_wazona: prediction.soft,
        przedzial_produkcyjny_dolny: productionInterval
          ? productionPrediction + productionInterval.lower
          : null,
        przedzial_produkcyjny_gorny: productionInterval
          ? productionPrediction + productionInterval.upper
          : null,
        przedzial_segmentowy_produkcji_dolny: productionSegmentInterval
          ? productionPrediction + productionSegmentInterval.lower
          : null,
        przedzial_segmentowy_produkcji_gorny: productionSegmentInterval
          ? productionPrediction + productionSegmentInterval.upper
          : null,
        przedzial_dwuczesciowy_dolny: segmentedInterval
          ? prediction.segmented + segmentedInterval.lower
          : null,
        przedzial_dwuczesciowy_gorny: segmentedInterval
          ? prediction.segmented + segmentedInterval.upper
          : null,
      });
    }

    for (const threshold of SENSITIVITY_THRESHOLDS) {
      const thresholdModels =
        threshold === RISK_PROBABILITY_THRESHOLD ? models : fitModels(trainRows, threshold);
      for (const row of testRows) {
        const productionPrediction = numeric(
          productionIndex.get(key(row)).prognoza_model_trend_delta_laczony,
        );
        const prediction = predictRow(row, thresholdModels, productionPrediction, threshold);
        sensitivity[threshold].push({
          rekrutacja: testRound,
          rzeczywisty_prog: row.target,
          segment: prediction.segment,
          prognoza_produkcyjna: productionPrediction,
          prognoza_dwuczesciowa: prediction.segmented,
          prognoza_mieszanina_wazona: prediction.soft,
        });
      }
    }
  }

  const numericOutputFields = [
    "szansa_pelnej_puli_przed_runda",
    "rzeczywisty_prog",
    "prognoza_bazowa",
    "prognoza_produkcyjna",
    "prognoza_z_szansa_zapelnienia",
    "prognoza_modelu_ryzyka",
    "prognoza_dwuczesciowa",
    "prognoza_mieszanina_wazona",
    "przedzial_produkcyjny_dolny",
    "przedzial_produkcyjny_gorny",
    "przedzial_segmentowy_produkcji_dolny",
    "przedzial_segmentowy_produkcji_gorny",
    "przedzial_dwuczesciowy_dolny",
    "przedzial_dwuczesciowy_gorny",
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
    "segment",
    "model_ryzyka_zastepczy",
    ...numericOutputFields,
  ]);

  const fields = {
    baseline: "prognoza_bazowa",
    production: "prognoza_produkcyjna",
    gate_feature: "prognoza_z_szansa_zapelnienia",
    two_part: "prognoza_dwuczesciowa",
    soft_mixture: "prognoza_mieszanina_wazona",
  };
  const variantMetrics = (subset) =>
    Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, metrics(subset, field)]));
  const segments = ["konkurencyjna", "ryzyko_zalamania_progu"];
  const intervalRows = experimentRows.filter((row) => Number.isFinite(row.przedzial_dwuczesciowy_dolny));
  const intervalBlock = (subset) => ({
    production_pooled: intervalSummary(subset, "przedzial_produkcyjny_dolny", "przedzial_produkcyjny_gorny"),
    production_by_segment: intervalSummary(
      subset,
      "przedzial_segmentowy_produkcji_dolny",
      "przedzial_segmentowy_produkcji_gorny",
    ),
    two_part_by_segment: intervalSummary(
      subset,
      "przedzial_dwuczesciowy_dolny",
      "przedzial_dwuczesciowy_gorny",
    ),
  });
  const roundIntervalBlock = (block) =>
    Object.fromEntries(
      Object.entries(block).map(([name, value]) => [
        name,
        { n: value.n, coverage: round(value.coverage), mean_width: round(value.mean_width) },
      ]),
    );

  // Prognoza shadow: modele uczone na wszystkich rundach przed prognozowaną,
  // przedziały z reszt całego backtestu.
  const forecastIndex = roundIndex.get(forecastRound);
  const finalTrainRows = enriched.filter(
    (row) => roundIndex.get(row.rekrutacja) < forecastIndex && isCompetitiveTarget(row),
  );
  const futureRows = enriched.filter(
    (row) => row.rekrutacja === forecastRound && row.status_konkurencyjnosci === "wynik_niedostepny",
  );
  const finalModels = fitModels(finalTrainRows, RISK_PROBABILITY_THRESHOLD);
  const productionForecastIndex = new Map(forecasts.map((row) => [key(row), row]));
  const allSegmentedResiduals = experimentRows.map(
    (row) => row.rzeczywisty_prog - row.prognoza_dwuczesciowa,
  );
  const allProductionResiduals = experimentRows.map(
    (row) => row.rzeczywisty_prog - row.prognoza_produkcyjna,
  );
  const shadowForecast = futureRows
    .filter((row) => Number.isFinite(numeric(productionForecastIndex.get(key(row))?.prognoza_modelowa)))
    .map((row) => {
      const productionPrediction = numeric(productionForecastIndex.get(key(row)).prognoza_modelowa);
      const prediction = predictRow(row, finalModels, productionPrediction, RISK_PROBABILITY_THRESHOLD);
      const interval = residualInterval(
        experimentRows
          .filter((candidate) => candidate.segment === prediction.segment)
          .map((candidate) => candidate.rzeczywisty_prog - candidate.prognoza_dwuczesciowa),
        allSegmentedResiduals,
      );
      const productionInterval = residualInterval(
        experimentRows
          .filter((candidate) => candidate.segment === prediction.segment)
          .map((candidate) => candidate.rzeczywisty_prog - candidate.prognoza_produkcyjna),
        allProductionResiduals,
      );
      return {
        rekrutacja: forecastRound,
        wojewodztwo: row.wojewodztwo,
        dziedzina_medycyny: row.dziedzina_medycyny,
        egzamin: row.egzamin,
        liczba_miejsc: row.oferowane_miejsca_rezydenckie,
        szansa_pelnej_puli_przed_runda: round(prediction.probability, 6),
        segment: prediction.segment,
        prognoza_produkcyjna: round(productionPrediction),
        prognoza_dwuczesciowa: round(prediction.segmented),
        przedzial_segmentowy_produkcji_dolny_80: productionInterval
          ? round(Math.max(0, productionPrediction + productionInterval.lower))
          : null,
        przedzial_segmentowy_produkcji_gorny_80: productionInterval
          ? round(Math.min(100, productionPrediction + productionInterval.upper))
          : null,
        przedzial_dolny_80: interval ? round(Math.max(0, prediction.segmented + interval.lower)) : null,
        przedzial_gorny_80: interval ? round(Math.min(100, prediction.segmented + interval.upper)) : null,
        status: "shadow_do_oceny_po_publikacji_wynikow",
      };
    });
  writeCsv(forecastFile, shadowForecast, Object.keys(shadowForecast[0] ?? {}));

  return {
    status: "experimental_only_production_unchanged",
    question:
      "Czy rozdzielenie pul zagrożonych zapełnieniem na styk od pul konkurencyjnych zmniejsza błąd i daje uczciwsze przedziały?",
    validation:
      "rolling-origin; identyczne regionalne progi jak w głównym backteście; szansa zapełnienia z modelu uczonego tylko na wcześniejszych rundach",
    design: {
      gate: "surowa szansa pełnej puli z produkcyjnego modelu zapełnienia; cel zapełnienia pozostaje osobny",
      risk_probability_threshold: RISK_PROBABILITY_THRESHOLD,
      threshold_choice:
        "ustalony po diagnostyce błędów obecnego backtestu (analiza post hoc); inne progi tylko jako wrażliwość",
      competitive_segment: "prognoza produkcyjnego ensemble bez zmian",
      risk_segment: `ridge uczony tylko na wcześniejszych pełnych pulach z szansą < ${RISK_PROBABILITY_THRESHOLD}; cechy bazowe, logit szansy i cechy podaży`,
      gate_feature_variant: "ridge na pełnych pulach ze znaną szansą zapełnienia przed rundą, z dodanym logitem szansy",
      soft_mixture: "p × produkcja + (1 - p) × model ryzyka",
      intervals:
        "kwantyle 10/90 reszt z wcześniejszych rund backtestu: łącznie wokół produkcji, osobno dla segmentu wokół produkcji oraz osobno dla segmentu wokół prognozy dwuczęściowej",
      posthoc_note:
        "Przedział segmentowy wokół produkcji oraz uczenie cechy szansy tylko na rundach z dostępną szansą dodano po pierwszym uruchomieniu eksperymentu.",
      min_risk_training_rows: MIN_RISK_TRAINING_ROWS,
    },
    rows: roundedRows.length,
    folds: foldInfo,
    variants: variantMetrics(roundedRows),
    by_segment: Object.fromEntries(
      segments.map((segment) => {
        const subset = roundedRows.filter((row) => row.segment === segment);
        return [segment, { n: subset.length, ...variantMetrics(subset) }];
      }),
    ),
    by_round: Object.fromEntries(
      testRounds.map((roundName) => [
        roundName,
        variantMetrics(roundedRows.filter((row) => row.rekrutacja === roundName)),
      ]),
    ),
    by_exam: Object.fromEntries(
      ["LEK", "LDEK"].map((exam) => [
        exam,
        variantMetrics(roundedRows.filter((row) => row.egzamin === exam)),
      ]),
    ),
    paired_vs_production: {
      two_part: pairedCounts(roundedRows, fields.two_part, fields.production),
      soft_mixture: pairedCounts(roundedRows, fields.soft_mixture, fields.production),
      gate_feature: pairedCounts(roundedRows, fields.gate_feature, fields.production),
    },
    intervals_80: {
      evaluated_rounds: [...new Set(intervalRows.map((row) => row.rekrutacja))],
      overall: roundIntervalBlock(intervalBlock(intervalRows)),
      by_segment: Object.fromEntries(
        segments.map((segment) => [
          segment,
          roundIntervalBlock(intervalBlock(intervalRows.filter((row) => row.segment === segment))),
        ]),
      ),
    },
    threshold_sensitivity: Object.fromEntries(
      SENSITIVITY_THRESHOLDS.map((threshold) => {
        const subset = sensitivity[threshold];
        return [
          threshold,
          {
            risk_rows: subset.filter((row) => row.segment === "ryzyko_zalamania_progu").length,
            two_part: metrics(subset, "prognoza_dwuczesciowa"),
            soft_mixture: metrics(subset, "prognoza_mieszanina_wazona"),
          },
        ];
      }),
    ),
    frozen_shadow_forecast: {
      round: forecastRound,
      rows: shadowForecast.length,
      risk_rows: shadowForecast.filter((row) => row.segment === "ryzyko_zalamania_progu").length,
      output: path.relative(root, forecastFile).replaceAll("\\", "/"),
      production_unchanged: true,
    },
    outputs: {
      backtest: path.relative(root, backtestFile).replaceAll("\\", "/"),
      forecast: path.relative(root, forecastFile).replaceAll("\\", "/"),
    },
    limitations: [
      "Próg segmentu 0,8 dobrano po obejrzeniu błędów tego samego backtestu; wymaga oceny na nowej rundzie.",
      "Trzy pierwsze rundy nie mają szansy zapełnienia przed rundą, więc modele korzystające z szansy uczą się na krótszej historii.",
      "Segment ryzyka ma niewiele obserwacji uczących, zwłaszcza w pierwszej rundzie testowej.",
    ],
  };
}

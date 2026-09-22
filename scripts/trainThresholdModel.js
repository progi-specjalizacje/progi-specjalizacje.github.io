import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const dataDir = path.join(root, "prediction", "data");
const datasetFile = path.join(dataDir, "recruitment_model_dataset.csv");
const scopeFile = path.join(dataDir, "model_scope_candidates.csv");
const backtestFile = path.join(dataDir, "threshold_model_backtest.csv");
const forecastFile = path.join(dataDir, "threshold_forecast_j-2026.csv");
const pilotForecastFile = path.join(dataDir, "threshold_forecast_j-2026_pilot.csv");
const nationalBacktestFile = path.join(dataDir, "national_threshold_backtest.csv");
const nationalForecastFile = path.join(dataDir, "national_threshold_forecast_j-2026.csv");
const fillBacktestFile = path.join(dataDir, "fill_model_backtest.csv");
const fillForecastFile = path.join(dataDir, "fill_forecast_j-2026.csv");
const reportFile = path.join(dataDir, "threshold_model_report.json");

const ROUND_ORDER = ["w-2023", "j-2023", "w-2024", "j-2024", "w-2025", "j-2025", "w-2026", "j-2026"];
const RIDGE_LAMBDA = 20;
const FILL_RIDGE_LAMBDA = 2;
const EXAM_BLEND_WEIGHT = 0.25;
const HISTORICAL_TEST_ROUNDS = ROUND_ORDER.slice(3, -1);
const FORECAST_ROUND = "j-2026";

const BASE_NUMERIC_FEATURES = [
  "log_miejsca",
  "zmiana_miejsc",
  "poprzednie_miejsca",
  "poprzednio_zakwalifikowani",
  "poprzednie_wypelnienie",
  "ostatni_obserwowany_wynik",
  "ostatni_konkurencyjny_prog",
  "sredni_historyczny_prog_konkurencyjny",
  "liczba_historycznych_pelnych_pul",
  "sredni_prog_specjalizacji_przed_runda",
  "sredni_prog_wojewodztwa_przed_runda",
  "sredni_prog_globalny_przed_runda",
];

const EXAM_FEATURES = [
  "egzamin_srednia_proc",
  "log_liczba_przystepujacych",
  "egzamin_odsetek_ponizej_56_proc",
  "egzamin_zmiana_sredniej_proc",
  "egzamin_srednia_proc_4_sesje",
  "egzamin_odchylenie_od_4_sesji",
];
const EXAM_SD_FEATURES = [...EXAM_FEATURES, "egzamin_sd_dostepne_proc"];
const EXAM_PREVIOUS_SD_FEATURES = [...EXAM_FEATURES, "egzamin_poprzednie_sd_proc"];
const EXAM_ANCHORED_FEATURES = [
  ...BASE_NUMERIC_FEATURES,
  "log_liczba_przystepujacych",
  "egzamin_odsetek_ponizej_56_proc",
  "egzamin_zmiana_sredniej_proc",
  "egzamin_odchylenie_od_4_sesji",
];

const FILL_NUMERIC_FEATURES = [
  "log_miejsca",
  "log_miejsca_kraj_specjalizacja",
  "liczba_wojewodztw_z_oferta_specjalizacja",
  "zmiana_miejsc_kraj_specjalizacja",
  "udzial_miejsc_wojewodztwa_w_specjalizacji",
  "zmiana_miejsc",
  "poprzednie_miejsca",
  "poprzednio_zakwalifikowani",
  "poprzednie_wypelnienie",
  "liczba_historycznych_ofert",
  "liczba_historycznych_pelnych_pul",
  "historyczny_udzial_pelnych_komorki",
  "historyczny_udzial_pelnych_specjalizacji",
  "historyczny_udzial_pelnych_wojewodztwa",
  "historyczny_udzial_pelnych_globalny",
  "ostatni_obserwowany_wynik",
  "sredni_historyczny_prog_konkurencyjny",
];

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value);
  return values;
}

function readCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function csvValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath, rows, columns) {
  const lines = [columns.join(",")];
  lines.push(...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")));
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function numeric(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function groupBy(rows, keyFunction) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFunction(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function isCompetitiveTarget(row) {
  return (
    row.status_konkurencyjnosci === "pelna_pula_proxy_konkurencji" &&
    numeric(row.prog_min_proc) !== null
  );
}

function isFillObservation(row) {
  return (
    numeric(row.oferowane_miejsca_rezydenckie) > 0 &&
    [
      "pelna_pula_proxy_konkurencji",
      "niepelna_pula_brak_progu_konkurencyjnego",
      "niepelna_pula_bez_zakwalifikowanych",
    ].includes(row.status_konkurencyjnosci)
  );
}

function fillTarget(row) {
  return row.status_konkurencyjnosci === "pelna_pula_proxy_konkurencji" ? 1 : 0;
}

function addHistoricalFeatures(rows) {
  const roundIndex = new Map(ROUND_ORDER.map((roundName, index) => [roundName, index]));
  const sorted = [...rows].sort((a, b) => roundIndex.get(a.rekrutacja) - roundIndex.get(b.rekrutacja));
  const result = [];

  for (const row of sorted) {
    const currentIndex = roundIndex.get(row.rekrutacja);
    const prior = sorted.filter((candidate) => roundIndex.get(candidate.rekrutacja) < currentIndex);
    const currentSpecialtyOffer = sorted.filter(
      (candidate) =>
        candidate.rekrutacja === row.rekrutacja &&
        candidate.dziedzina_medycyny === row.dziedzina_medycyny &&
        numeric(candidate.oferowane_miejsca_rezydenckie) > 0,
    );
    const sameCell = prior.filter(
      (candidate) =>
        candidate.dziedzina_medycyny === row.dziedzina_medycyny &&
        candidate.wojewodztwo === row.wojewodztwo,
    );
    const lastCell = sameCell.at(-1);
    const observedCell = sameCell.filter((candidate) => numeric(candidate.prog_min_proc) !== null);
    const competitiveCell = sameCell.filter(isCompetitiveTarget);
    const offeredCell = sameCell.filter(
      isFillObservation,
    );
    const offeredSpecialty = prior.filter(
      (candidate) => candidate.dziedzina_medycyny === row.dziedzina_medycyny && isFillObservation(candidate),
    );
    const offeredRegion = prior.filter(
      (candidate) => candidate.wojewodztwo === row.wojewodztwo && isFillObservation(candidate),
    );
    const offeredGlobal = prior.filter(isFillObservation);
    const competitiveSpecialty = prior.filter(
      (candidate) => candidate.dziedzina_medycyny === row.dziedzina_medycyny && isCompetitiveTarget(candidate),
    );
    const competitiveRegion = prior.filter(
      (candidate) => candidate.wojewodztwo === row.wojewodztwo && isCompetitiveTarget(candidate),
    );
    const competitiveGlobal = prior.filter(isCompetitiveTarget);
    const places = numeric(row.oferowane_miejsca_rezydenckie);
    const nationalSpecialtyPlaces = currentSpecialtyOffer.reduce(
      (sum, candidate) => sum + numeric(candidate.oferowane_miejsca_rezydenckie),
      0,
    );
    const priorSpecialtyOfferRounds = [...new Set(
      prior
        .filter(
          (candidate) =>
            candidate.dziedzina_medycyny === row.dziedzina_medycyny &&
            numeric(candidate.oferowane_miejsca_rezydenckie) > 0,
        )
        .map((candidate) => candidate.rekrutacja),
    )];
    const previousSpecialtyOfferRound = priorSpecialtyOfferRounds.at(-1);
    const previousNationalSpecialtyPlaces = previousSpecialtyOfferRound
      ? prior
          .filter(
            (candidate) =>
              candidate.rekrutacja === previousSpecialtyOfferRound &&
              candidate.dziedzina_medycyny === row.dziedzina_medycyny,
          )
          .reduce(
            (sum, candidate) => sum + (numeric(candidate.oferowane_miejsca_rezydenckie) ?? 0),
            0,
          )
      : null;
    const previousPlaces = numeric(lastCell?.oferowane_miejsca_rezydenckie);
    const examMean = numeric(row.egzamin_srednia_proc);
    const examTrailingMean = numeric(row.egzamin_srednia_proc_4_sesje);

    result.push({
      ...row,
      target: numeric(row.prog_min_proc),
      log_miejsca: places === null ? null : Math.log1p(places),
      log_miejsca_kraj_specjalizacja: Math.log1p(nationalSpecialtyPlaces),
      liczba_wojewodztw_z_oferta_specjalizacja: currentSpecialtyOffer.length,
      zmiana_miejsc_kraj_specjalizacja:
        previousNationalSpecialtyPlaces === null
          ? null
          : nationalSpecialtyPlaces - previousNationalSpecialtyPlaces,
      udzial_miejsc_wojewodztwa_w_specjalizacji:
        places !== null && nationalSpecialtyPlaces > 0 ? places / nationalSpecialtyPlaces : null,
      zmiana_miejsc: places !== null && previousPlaces !== null ? places - previousPlaces : null,
      poprzednie_miejsca: previousPlaces,
      poprzednio_zakwalifikowani: numeric(lastCell?.liczba_zakwalifikowanych),
      poprzednie_wypelnienie: numeric(lastCell?.wskaznik_wypelnienia),
      ostatni_obserwowany_wynik: numeric(observedCell.at(-1)?.prog_min_proc),
      ostatni_konkurencyjny_prog: numeric(competitiveCell.at(-1)?.prog_min_proc),
      sredni_historyczny_prog_konkurencyjny: mean(
        competitiveCell.map((candidate) => numeric(candidate.prog_min_proc)),
      ),
      liczba_historycznych_pelnych_pul: competitiveCell.length,
      liczba_historycznych_ofert: offeredCell.length,
      historyczny_udzial_pelnych_komorki: offeredCell.length
        ? offeredCell.filter((candidate) => fillTarget(candidate) === 1).length / offeredCell.length
        : null,
      historyczny_udzial_pelnych_specjalizacji: offeredSpecialty.length
        ? offeredSpecialty.filter((candidate) => fillTarget(candidate) === 1).length / offeredSpecialty.length
        : null,
      historyczny_udzial_pelnych_wojewodztwa: offeredRegion.length
        ? offeredRegion.filter((candidate) => fillTarget(candidate) === 1).length / offeredRegion.length
        : null,
      historyczny_udzial_pelnych_globalny: offeredGlobal.length
        ? offeredGlobal.filter((candidate) => fillTarget(candidate) === 1).length / offeredGlobal.length
        : null,
      scisly_stabilny_przed_runda:
        offeredCell.length >= 5 &&
        competitiveCell.length >= 4 &&
        competitiveCell.length / offeredCell.length >= 0.7 &&
        quantile(
          offeredCell
            .filter((candidate) => numeric(candidate.prog_min_proc) !== null)
            .map((candidate) => numeric(candidate.liczba_zakwalifikowanych)),
          0.5,
        ) >= 3 &&
        quantile(competitiveCell.map((candidate) => numeric(candidate.prog_min_proc)), 0.5) >= 75,
      sredni_prog_specjalizacji_przed_runda: mean(
        competitiveSpecialty.map((candidate) => numeric(candidate.prog_min_proc)),
      ),
      sredni_prog_wojewodztwa_przed_runda: mean(
        competitiveRegion.map((candidate) => numeric(candidate.prog_min_proc)),
      ),
      sredni_prog_globalny_przed_runda: mean(
        competitiveGlobal.map((candidate) => numeric(candidate.prog_min_proc)),
      ),
      log_liczba_przystepujacych:
        numeric(row.egzamin_liczba_przystepujacych) === null
          ? null
          : Math.log1p(numeric(row.egzamin_liczba_przystepujacych)),
      egzamin_odchylenie_od_4_sesji:
        examMean !== null && examTrailingMean !== null ? examMean - examTrailingMean : null,
    });
  }
  return result;
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const pivotValue = augmented[column][column];
    if (Math.abs(pivotValue) < 1e-10) continue;
    for (let index = column; index <= size; index += 1) augmented[column][index] /= pivotValue;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

function fitRidge(trainRows, numericFeatures) {
  const categoryFields = ["dziedzina_medycyny", "wojewodztwo", "sezon", "egzamin"];
  const categoryLevels = Object.fromEntries(
    categoryFields.map((field) => [field, [...new Set(trainRows.map((row) => row[field]))].sort()]),
  );
  const numericStats = Object.fromEntries(
    numericFeatures.map((feature) => {
      const values = trainRows.map((row) => numeric(row[feature])).filter(Number.isFinite);
      const featureMean = mean(values) ?? 0;
      const variance = mean(values.map((value) => (value - featureMean) ** 2)) ?? 0;
      return [feature, { mean: featureMean, standardDeviation: Math.sqrt(variance) || 1 }];
    }),
  );

  function vectorize(row) {
    const vector = [1];
    for (const feature of numericFeatures) {
      const stats = numericStats[feature];
      const value = numeric(row[feature]) ?? stats.mean;
      vector.push((value - stats.mean) / stats.standardDeviation);
    }
    for (const field of categoryFields) {
      for (const level of categoryLevels[field]) vector.push(row[field] === level ? 1 : 0);
    }
    return vector;
  }

  const vectors = trainRows.map(vectorize);
  const targets = trainRows.map((row) => row.target);
  const size = vectors[0].length;
  const xtx = Array.from({ length: size }, () => Array(size).fill(0));
  const xty = Array(size).fill(0);
  for (let row = 0; row < vectors.length; row += 1) {
    for (let left = 0; left < size; left += 1) {
      xty[left] += vectors[row][left] * targets[row];
      for (let right = 0; right < size; right += 1) {
        xtx[left][right] += vectors[row][left] * vectors[row][right];
      }
    }
  }
  for (let index = 1; index < size; index += 1) xtx[index][index] += RIDGE_LAMBDA;
  const coefficients = solveLinearSystem(xtx, xty);
  return {
    predict(row) {
      const vector = vectorize(row);
      return clamp(vector.reduce((sum, value, index) => sum + value * coefficients[index], 0));
    },
  };
}

function sigmoid(value) {
  const bounded = Math.max(-30, Math.min(30, value));
  return 1 / (1 + Math.exp(-bounded));
}

function fitFillLogistic(trainRows) {
  const categoryFields = ["dziedzina_medycyny", "wojewodztwo", "sezon"];
  const categoryLevels = Object.fromEntries(
    categoryFields.map((field) => [field, [...new Set(trainRows.map((row) => row[field]))].sort()]),
  );
  const numericStats = Object.fromEntries(
    FILL_NUMERIC_FEATURES.map((feature) => {
      const values = trainRows.map((row) => numeric(row[feature])).filter(Number.isFinite);
      const featureMean = mean(values) ?? 0;
      const variance = mean(values.map((value) => (value - featureMean) ** 2)) ?? 0;
      return [feature, { mean: featureMean, standardDeviation: Math.sqrt(variance) || 1 }];
    }),
  );

  function vectorize(row) {
    const vector = [1];
    for (const feature of FILL_NUMERIC_FEATURES) {
      const stats = numericStats[feature];
      const value = numeric(row[feature]) ?? stats.mean;
      vector.push((value - stats.mean) / stats.standardDeviation);
    }
    for (const field of categoryFields) {
      for (const level of categoryLevels[field]) vector.push(row[field] === level ? 1 : 0);
    }
    return vector;
  }

  const vectors = trainRows.map(vectorize);
  const targets = trainRows.map(fillTarget);
  const size = vectors[0].length;
  const prevalence = clamp(mean(targets) ?? 0.5, 0.001, 0.999);
  let coefficients = Array(size).fill(0);
  coefficients[0] = Math.log(prevalence / (1 - prevalence));

  for (let iteration = 0; iteration < 25; iteration += 1) {
    const hessian = Array.from({ length: size }, () => Array(size).fill(0));
    const gradient = Array(size).fill(0);
    for (let rowIndex = 0; rowIndex < vectors.length; rowIndex += 1) {
      const vector = vectors[rowIndex];
      const probability = sigmoid(
        vector.reduce((sum, value, index) => sum + value * coefficients[index], 0),
      );
      const weight = Math.max(probability * (1 - probability), 1e-6);
      for (let left = 0; left < size; left += 1) {
        gradient[left] += vector[left] * (probability - targets[rowIndex]);
        for (let right = 0; right < size; right += 1) {
          hessian[left][right] += vector[left] * weight * vector[right];
        }
      }
    }
    for (let index = 1; index < size; index += 1) {
      gradient[index] += FILL_RIDGE_LAMBDA * coefficients[index];
      hessian[index][index] += FILL_RIDGE_LAMBDA;
    }
    const step = solveLinearSystem(hessian, gradient);
    coefficients = coefficients.map((value, index) => value - step[index]);
    if (Math.max(...step.map(Math.abs)) < 1e-6) break;
  }

  return {
    predict(row) {
      const vector = vectorize(row);
      return sigmoid(vector.reduce((sum, value, index) => sum + value * coefficients[index], 0));
    },
  };
}

function baselinePrediction(row, trainRows) {
  if (Number.isFinite(row.ostatni_konkurencyjny_prog)) return row.ostatni_konkurencyjny_prog;
  if (Number.isFinite(row.ostatni_obserwowany_wynik)) return row.ostatni_obserwowany_wynik;
  if (Number.isFinite(row.sredni_prog_specjalizacji_przed_runda)) {
    return row.sredni_prog_specjalizacji_przed_runda;
  }
  return mean(trainRows.map((candidate) => candidate.target));
}

function metrics(rows, predictionField) {
  const errors = rows
    .map((row) => numeric(row[predictionField]) - numeric(row.rzeczywisty_prog))
    .filter(Number.isFinite);
  return {
    n: errors.length,
    mae: round(mean(errors.map(Math.abs))),
    rmse: round(Math.sqrt(mean(errors.map((error) => error ** 2)))),
    bias: round(mean(errors)),
    error_p80: round(quantile(errors.map(Math.abs), 0.8)),
  };
}

const MODEL_FIELDS = {
  poprzedni_prog: "prognoza_poprzedni_prog",
  bez_egzaminu: "prognoza_model_bez_egzaminu",
  z_egzaminem: "prognoza_model_z_egzaminem",
  z_biezacym_sd: "prognoza_model_z_egzaminem_i_sd",
  z_poprzednim_sd: "prognoza_model_z_egzaminem_i_poprzednim_sd",
  kotwiczony_egzaminem: "prognoza_model_kotwiczony_egzaminem",
  laczony: "prognoza_model_laczony",
};

function compareModels(rows) {
  return Object.fromEntries(
    Object.entries(MODEL_FIELDS).map(([name, field]) => [name, metrics(rows, field)]),
  );
}

function compareWeightedModels(rows) {
  return Object.fromEntries(
    Object.entries(MODEL_FIELDS).map(([name, field]) => [
      name,
      metrics(rows, `wazona_${field}`),
    ]),
  );
}

function compareEmpiricalWeightedModels(rows) {
  return Object.fromEntries(
    Object.entries(MODEL_FIELDS).map(([name, field]) => [
      name,
      metrics(rows, `empiryczna_wazona_${field}`),
    ]),
  );
}

function weightedMean(values, weights) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!totalWeight) return null;
  return values.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight;
}

function estimateFullProbability(row, historicalRows) {
  const offered = historicalRows.filter(
    (candidate) => numeric(candidate.oferowane_miejsca_rezydenckie) > 0,
  );
  const specialty = offered.filter(
    (candidate) => candidate.dziedzina_medycyny === row.dziedzina_medycyny,
  );
  const cell = specialty.filter((candidate) => candidate.wojewodztwo === row.wojewodztwo);
  const globalRate = offered.length
    ? offered.filter(isCompetitiveTarget).length / offered.length
    : 0.5;
  const specialtyRate =
    (specialty.filter(isCompetitiveTarget).length + 8 * globalRate) / (specialty.length + 8);
  return (cell.filter(isCompetitiveTarget).length + 3 * specialtyRate) / (cell.length + 3);
}

function classificationMetrics(rows, probabilityField) {
  const observations = rows
    .map((row) => ({
      actual: numeric(row.czy_pelna_pula),
      probability: numeric(row[probabilityField]),
    }))
    .filter(({ actual, probability }) => Number.isFinite(actual) && Number.isFinite(probability));
  if (!observations.length) return { n: 0, brier: null, log_loss: null, auc: null };
  const brier = mean(observations.map(({ actual, probability }) => (probability - actual) ** 2));
  const logLoss = -mean(
    observations.map(({ actual, probability }) => {
      const bounded = clamp(probability, 1e-9, 1 - 1e-9);
      return actual * Math.log(bounded) + (1 - actual) * Math.log(1 - bounded);
    }),
  );
  const positives = observations.filter(({ actual }) => actual === 1);
  const negatives = observations.filter(({ actual }) => actual === 0);
  const pairScore = positives.length && negatives.length
    ? mean(
        positives.flatMap((positive) =>
          negatives.map((negative) =>
            positive.probability > negative.probability
              ? 1
              : positive.probability === negative.probability
                ? 0.5
                : 0,
          ),
        ),
      )
    : null;
  return {
    n: observations.length,
    observed_rate: round(mean(observations.map(({ actual }) => actual))),
    mean_probability: round(mean(observations.map(({ probability }) => probability))),
    brier: round(brier, 4),
    log_loss: round(logLoss, 4),
    auc: round(pairScore, 4),
    accuracy_050: round(
      mean(observations.map(({ actual, probability }) => (probability >= 0.5 ? 1 : 0) === actual ? 1 : 0)),
      4,
    ),
  };
}

function calibrationBins(rows, probabilityField) {
  return [
    [0, 0.2],
    [0.2, 0.4],
    [0.4, 0.6],
    [0.6, 0.8],
    [0.8, 1.000001],
  ].map(([minimum, maximum]) => {
    const binRows = rows.filter((row) => {
      const probability = numeric(row[probabilityField]);
      return probability >= minimum && probability < maximum;
    });
    return {
      przedzial: `${minimum.toFixed(1)}-${Math.min(maximum, 1).toFixed(1)}`,
      n: binRows.length,
      srednie_prawdopodobienstwo: round(
        mean(binRows.map((row) => numeric(row[probabilityField]))),
        4,
      ),
      rzeczywisty_udzial_pelnych: round(
        mean(binRows.map((row) => numeric(row.czy_pelna_pula))),
        4,
      ),
    };
  });
}

function predictAllVariants(row, trainRows, models) {
  const withoutExam = models.withoutExam.predict(row);
  const withExam = models.withExam.predict(row);
  const withSd = models.withExamAndSd.predict(row);
  const withPreviousSd = models.withExamAndPreviousSd.predict(row);
  return {
    prognoza_poprzedni_prog: baselinePrediction(row, trainRows),
    prognoza_model_bez_egzaminu: withoutExam,
    prognoza_model_z_egzaminem: withExam,
    prognoza_model_z_egzaminem_i_sd: withSd,
    prognoza_model_z_egzaminem_i_poprzednim_sd: withPreviousSd,
    prognoza_model_kotwiczony_egzaminem: clamp(
      models.examAnchored.predict(row) - 50 + numeric(row.egzamin_srednia_proc),
    ),
    prognoza_model_laczony: withoutExam * (1 - EXAM_BLEND_WEIGHT) + withExam * EXAM_BLEND_WEIGHT,
  };
}

const rawRows = readCsv(datasetFile);
const rows = addHistoricalFeatures(rawRows);
const roundIndex = new Map(ROUND_ORDER.map((roundName, index) => [roundName, index]));
const backtestRows = [];
const nationalBacktestRows = [];
const fillBacktestRows = [];

for (const testRound of HISTORICAL_TEST_ROUNDS) {
  const testIndex = roundIndex.get(testRound);
  const trainRows = rows.filter(
    (row) => roundIndex.get(row.rekrutacja) < testIndex && isCompetitiveTarget(row),
  );
  const testRows = rows.filter(
    (row) =>
      row.rekrutacja === testRound &&
      isCompetitiveTarget(row) &&
      row.liczba_historycznych_pelnych_pul >= 1,
  );
  const fillTrainRows = rows.filter(
    (row) => roundIndex.get(row.rekrutacja) < testIndex && isFillObservation(row),
  );
  const fillTestRows = rows.filter(
    (row) => row.rekrutacja === testRound && isFillObservation(row),
  );
  if (!trainRows.length || !testRows.length || !fillTrainRows.length) continue;

  const withoutExam = fitRidge(trainRows, BASE_NUMERIC_FEATURES);
  const withExam = fitRidge(trainRows, [...BASE_NUMERIC_FEATURES, ...EXAM_FEATURES]);
  const withExamAndSd = fitRidge(trainRows, [...BASE_NUMERIC_FEATURES, ...EXAM_SD_FEATURES]);
  const withExamAndPreviousSd = fitRidge(
    trainRows,
    [...BASE_NUMERIC_FEATURES, ...EXAM_PREVIOUS_SD_FEATURES],
  );
  const examAnchored = fitRidge(
    trainRows.map((row) => ({
      ...row,
      target: 50 + row.target - numeric(row.egzamin_srednia_proc),
    })),
    EXAM_ANCHORED_FEATURES,
  );
  const foldModels = { withoutExam, withExam, withExamAndSd, withExamAndPreviousSd, examAnchored };
  const fillModel = fitFillLogistic(fillTrainRows);
  const priorToRound = rawRows.filter(
    (candidate) => roundIndex.get(candidate.rekrutacja) < testIndex,
  );
  for (const row of fillTestRows) {
    fillBacktestRows.push({
      rekrutacja: testRound,
      wojewodztwo: row.wojewodztwo,
      dziedzina_medycyny: row.dziedzina_medycyny,
      egzamin: row.egzamin,
      liczba_miejsc: row.oferowane_miejsca_rezydenckie,
      czy_pelna_pula: fillTarget(row),
      prawdopodobienstwo_model_logistyczny: round(fillModel.predict(row), 6),
      prawdopodobienstwo_wygladzona_historia: round(
        estimateFullProbability(row, priorToRound),
        6,
      ),
    });
  }
  for (const row of testRows) {
    const baseline = baselinePrediction(row, trainRows);
    const predictionWithoutExam = withoutExam.predict(row);
    const predictionWithExam = withExam.predict(row);
    const predictionWithExamAndSd = withExamAndSd.predict(row);
    const predictionWithExamAndPreviousSd = withExamAndPreviousSd.predict(row);
    const predictionExamAnchored = clamp(
      examAnchored.predict(row) - 50 + numeric(row.egzamin_srednia_proc),
    );
    const ensemblePrediction =
      predictionWithoutExam * (1 - EXAM_BLEND_WEIGHT) + predictionWithExam * EXAM_BLEND_WEIGHT;
    backtestRows.push({
      rekrutacja: testRound,
      wojewodztwo: row.wojewodztwo,
      dziedzina_medycyny: row.dziedzina_medycyny,
      sciezka: row.sciezka,
      egzamin: row.egzamin,
      liczba_miejsc: row.oferowane_miejsca_rezydenckie,
      historyczne_pelne_pule: row.liczba_historycznych_pelnych_pul,
      scisly_stabilny_przed_runda: row.scisly_stabilny_przed_runda ? "TAK" : "NIE",
      rzeczywisty_prog: round(row.target),
      prognoza_poprzedni_prog: round(baseline),
      prognoza_model_bez_egzaminu: round(predictionWithoutExam),
      prognoza_model_z_egzaminem: round(predictionWithExam),
      prognoza_model_z_egzaminem_i_sd: round(predictionWithExamAndSd),
      prognoza_model_z_egzaminem_i_poprzednim_sd: round(predictionWithExamAndPreviousSd),
      prognoza_model_kotwiczony_egzaminem: round(predictionExamAnchored),
      prognoza_model_laczony: round(ensemblePrediction),
      blad_bezwzgledny_poprzedni_prog: round(Math.abs(baseline - row.target)),
      blad_bezwzgledny_bez_egzaminu: round(Math.abs(predictionWithoutExam - row.target)),
      blad_bezwzgledny_z_egzaminem: round(Math.abs(predictionWithExam - row.target)),
      blad_bezwzgledny_z_egzaminem_i_sd: round(Math.abs(predictionWithExamAndSd - row.target)),
      blad_bezwzgledny_z_egzaminem_i_poprzednim_sd: round(
        Math.abs(predictionWithExamAndPreviousSd - row.target),
      ),
      blad_bezwzgledny_model_kotwiczony_egzaminem: round(
        Math.abs(predictionExamAnchored - row.target),
      ),
      blad_bezwzgledny_model_laczony: round(Math.abs(ensemblePrediction - row.target)),
    });
  }

  const offeredBySpecialty = groupBy(
    rows.filter(
      (row) =>
        row.rekrutacja === testRound && numeric(row.oferowane_miejsca_rezydenckie) > 0,
    ),
    (row) => row.dziedzina_medycyny,
  );
  for (const [specialty, specialtyRows] of offeredBySpecialty) {
    const full = specialtyRows.filter(isCompetitiveTarget);
    const observed = specialtyRows.filter((row) => numeric(row.target) !== null);
    const provincialPredictions = specialtyRows.map((row) =>
      predictAllVariants(row, trainRows, foldModels),
    );
    const fillWeights = specialtyRows.map((row) => fillModel.predict(row));
    const empiricalFillWeights = specialtyRows.map((row) =>
      estimateFullProbability(row, priorToRound),
    );
    const result = {
      rekrutacja: testRound,
      dziedzina_medycyny: specialty,
      egzamin: specialtyRows[0].egzamin,
      regiony_z_oferta: specialtyRows.length,
      regiony_z_obserwowanym_wynikiem: observed.length,
      regiony_z_pelna_pula: full.length,
      udzial_pelnych_pul: round(full.length / specialtyRows.length),
      rzeczywisty_prog: round(mean(full.map((row) => row.target))),
      srednia_wszystkich_obserwowanych: round(mean(observed.map((row) => row.target))),
    };
    for (const field of Object.values(MODEL_FIELDS)) {
      result[field] = round(mean(provincialPredictions.map((prediction) => prediction[field])));
      result[`wazona_${field}`] = round(
        weightedMean(provincialPredictions.map((prediction) => prediction[field]), fillWeights),
      );
      result[`empiryczna_wazona_${field}`] = round(
        weightedMean(
          provincialPredictions.map((prediction) => prediction[field]),
          empiricalFillWeights,
        ),
      );
    }
    nationalBacktestRows.push(result);
  }
}

const backtestColumns = [
  "rekrutacja",
  "wojewodztwo",
  "dziedzina_medycyny",
  "sciezka",
  "egzamin",
  "liczba_miejsc",
  "historyczne_pelne_pule",
  "scisly_stabilny_przed_runda",
  "rzeczywisty_prog",
  "prognoza_poprzedni_prog",
  "prognoza_model_bez_egzaminu",
  "prognoza_model_z_egzaminem",
  "prognoza_model_z_egzaminem_i_sd",
  "prognoza_model_z_egzaminem_i_poprzednim_sd",
  "prognoza_model_kotwiczony_egzaminem",
  "prognoza_model_laczony",
  "blad_bezwzgledny_poprzedni_prog",
  "blad_bezwzgledny_bez_egzaminu",
  "blad_bezwzgledny_z_egzaminem",
  "blad_bezwzgledny_z_egzaminem_i_sd",
  "blad_bezwzgledny_z_egzaminem_i_poprzednim_sd",
  "blad_bezwzgledny_model_kotwiczony_egzaminem",
  "blad_bezwzgledny_model_laczony",
];
writeCsv(backtestFile, backtestRows, backtestColumns);

writeCsv(fillBacktestFile, fillBacktestRows, [
  "rekrutacja",
  "wojewodztwo",
  "dziedzina_medycyny",
  "egzamin",
  "liczba_miejsc",
  "czy_pelna_pula",
  "prawdopodobienstwo_model_logistyczny",
  "prawdopodobienstwo_wygladzona_historia",
]);

const nationalColumns = [
  "rekrutacja",
  "dziedzina_medycyny",
  "egzamin",
  "regiony_z_oferta",
  "regiony_z_obserwowanym_wynikiem",
  "regiony_z_pelna_pula",
  "udzial_pelnych_pul",
  "rzeczywisty_prog",
  "srednia_wszystkich_obserwowanych",
  ...Object.values(MODEL_FIELDS),
  ...Object.values(MODEL_FIELDS).map((field) => `wazona_${field}`),
  ...Object.values(MODEL_FIELDS).map((field) => `empiryczna_wazona_${field}`),
];
writeCsv(nationalBacktestFile, nationalBacktestRows, nationalColumns);

const historicalTrainingRows = rows.filter(
  (row) => roundIndex.get(row.rekrutacja) < roundIndex.get(FORECAST_ROUND) && isCompetitiveTarget(row),
);
const futureRows = rows.filter(
  (row) => row.rekrutacja === FORECAST_ROUND && row.status_konkurencyjnosci === "wynik_niedostepny",
);
const scopeRows = readCsv(scopeFile);
const scopeIndex = new Map(
  scopeRows.map((row) => [[row.dziedzina_medycyny, row.wojewodztwo].join("::"), row.grupa_pilotazowa]),
);
const finalWithoutExam = fitRidge(historicalTrainingRows, BASE_NUMERIC_FEATURES);
const finalWithExam = fitRidge(historicalTrainingRows, [...BASE_NUMERIC_FEATURES, ...EXAM_FEATURES]);
const finalWithExamAndSd = fitRidge(historicalTrainingRows, [...BASE_NUMERIC_FEATURES, ...EXAM_SD_FEATURES]);
const finalWithExamAndPreviousSd = fitRidge(
  historicalTrainingRows,
  [...BASE_NUMERIC_FEATURES, ...EXAM_PREVIOUS_SD_FEATURES],
);
const finalExamAnchored = fitRidge(
  historicalTrainingRows.map((row) => ({
    ...row,
    target: 50 + row.target - numeric(row.egzamin_srednia_proc),
  })),
  EXAM_ANCHORED_FEATURES,
);
const finalFillTrainingRows = rows.filter(
  (row) => roundIndex.get(row.rekrutacja) < roundIndex.get(FORECAST_ROUND) && isFillObservation(row),
);
const finalFillModel = fitFillLogistic(finalFillTrainingRows);
const backtestWithTwoRounds = backtestRows.filter((row) => numeric(row.historyczne_pelne_pule) >= 2);
const backtestWithThreeRounds = backtestRows.filter((row) => numeric(row.historyczne_pelne_pule) >= 3);
const errorP80Low = metrics(backtestRows, "prognoza_model_laczony").error_p80;
const errorP80Medium = metrics(backtestWithTwoRounds, "prognoza_model_laczony").error_p80;
const errorP80High = metrics(backtestWithThreeRounds, "prognoza_model_laczony").error_p80;
const forecasts = futureRows.map((row) => {
  const predictionWithoutExam = finalWithoutExam.predict(row);
  const predictionWithExam = finalWithExam.predict(row);
  const predictionWithExamAndSd = finalWithExamAndSd.predict(row);
  const predictionWithExamAndPreviousSd = finalWithExamAndPreviousSd.predict(row);
  const predictionExamAnchored = clamp(
    finalExamAnchored.predict(row) - 50 + numeric(row.egzamin_srednia_proc),
  );
  const ensemblePrediction =
    predictionWithoutExam * (1 - EXAM_BLEND_WEIGHT) + predictionWithExam * EXAM_BLEND_WEIGHT;
  const scope = scopeIndex.get([row.dziedzina_medycyny, row.wojewodztwo].join("::")) ?? "C_poza_pilotazem";
  const historyCount = numeric(row.liczba_historycznych_pelnych_pul) ?? 0;
  const confidence =
    scope === "A_stabilny_pilotaz" && historyCount >= 4
      ? "wyzszy"
      : scope !== "C_poza_pilotazem" && historyCount >= 2
        ? "sredni"
        : "niski";
  const intervalError =
    confidence === "wyzszy" ? errorP80High : confidence === "sredni" ? errorP80Medium : errorP80Low;
  return {
    rekrutacja: FORECAST_ROUND,
    wojewodztwo: row.wojewodztwo,
    dziedzina_medycyny: row.dziedzina_medycyny,
    sciezka: row.sciezka,
    egzamin: row.egzamin,
    liczba_miejsc: row.oferowane_miejsca_rezydenckie,
    historyczne_pelne_pule: historyCount,
    grupa_pilotazowa: scope,
    poziom_pewnosci: confidence,
    egzamin_sd_zrodlo: row.egzamin_sd_zrodlo,
    prawdopodobienstwo_pelnej_puli: round(finalFillModel.predict(row), 6),
    prognoza_bez_egzaminu: round(predictionWithoutExam),
    prognoza_z_egzaminem: round(predictionWithExam),
    prognoza_z_egzaminem_i_sd: round(predictionWithExamAndSd),
    prognoza_z_egzaminem_i_poprzednim_sd: round(predictionWithExamAndPreviousSd),
    prognoza_kotwiczona_egzaminem: round(predictionExamAnchored),
    prognoza_modelowa: round(ensemblePrediction),
    dolna_granica_80_proc: round(clamp(ensemblePrediction - intervalError)),
    gorna_granica_80_proc: round(clamp(ensemblePrediction + intervalError)),
  };
});
forecasts.sort(
  (a, b) =>
    a.grupa_pilotazowa.localeCompare(b.grupa_pilotazowa, "pl") ||
    b.prognoza_modelowa - a.prognoza_modelowa,
);

const forecastColumns = [
  "rekrutacja",
  "wojewodztwo",
  "dziedzina_medycyny",
  "sciezka",
  "egzamin",
  "liczba_miejsc",
  "historyczne_pelne_pule",
  "grupa_pilotazowa",
  "poziom_pewnosci",
  "egzamin_sd_zrodlo",
  "prawdopodobienstwo_pelnej_puli",
  "prognoza_bez_egzaminu",
  "prognoza_z_egzaminem",
  "prognoza_z_egzaminem_i_sd",
  "prognoza_z_egzaminem_i_poprzednim_sd",
  "prognoza_kotwiczona_egzaminem",
  "prognoza_modelowa",
  "dolna_granica_80_proc",
  "gorna_granica_80_proc",
];
writeCsv(forecastFile, forecasts, forecastColumns);
writeCsv(
  pilotForecastFile,
  forecasts.filter((row) => row.grupa_pilotazowa !== "C_poza_pilotazem"),
  forecastColumns,
);
writeCsv(
  fillForecastFile,
  forecasts,
  [
    "rekrutacja",
    "wojewodztwo",
    "dziedzina_medycyny",
    "sciezka",
    "egzamin",
    "liczba_miejsc",
    "prawdopodobienstwo_pelnej_puli",
    "historyczne_pelne_pule",
    "grupa_pilotazowa",
  ],
);

const priorRows = rawRows.filter(
  (row) => roundIndex.get(row.rekrutacja) < roundIndex.get(FORECAST_ROUND),
);
const priorBySpecialty = groupBy(priorRows, (row) => row.dziedzina_medycyny);
const nationalForecasts = [...groupBy(forecasts, (row) => row.dziedzina_medycyny)].map(
  ([specialty, specialtyRows]) => {
    const prior = priorBySpecialty.get(specialty) ?? [];
    const offered = prior.filter((row) => numeric(row.oferowane_miejsca_rezydenckie) > 0);
    const full = offered.filter(isCompetitiveTarget);
    const pastRoundsWithOffer = new Set(offered.map((row) => row.rekrutacja)).size;
    const result = {
      rekrutacja: FORECAST_ROUND,
      dziedzina_medycyny: specialty,
      egzamin: specialtyRows[0].egzamin,
      regiony_z_oferta: specialtyRows.length,
      historyczne_rundy_z_oferta: pastRoundsWithOffer,
      historyczny_udzial_pelnych_pul: round(full.length / (offered.length || 1)),
      zakres_oceny:
        specialtyRows.length >= 3 &&
        pastRoundsWithOffer >= 4 &&
        offered.length >= 12 &&
        full.length / offered.length >= 0.8
          ? "szersze_pokrycie_historyczne"
          : "eksperymentalny",
      egzamin_sd_zrodlo: specialtyRows[0].egzamin_sd_zrodlo,
      oczekiwana_liczba_pelnych_pul: round(
        specialtyRows.reduce(
          (sum, row) => sum + numeric(row.prawdopodobienstwo_pelnej_puli),
          0,
        ),
      ),
    };
    const forecastMappings = {
      prognoza_model_bez_egzaminu: "prognoza_bez_egzaminu",
      prognoza_model_z_egzaminem: "prognoza_z_egzaminem",
      prognoza_model_z_egzaminem_i_sd: "prognoza_z_egzaminem_i_sd",
      prognoza_model_z_egzaminem_i_poprzednim_sd: "prognoza_z_egzaminem_i_poprzednim_sd",
      prognoza_model_kotwiczony_egzaminem: "prognoza_kotwiczona_egzaminem",
      prognoza_model_laczony: "prognoza_modelowa",
    };
    const fillWeights = specialtyRows.map((row) => numeric(row.prawdopodobienstwo_pelnej_puli));
    const empiricalFillWeights = specialtyRows.map((row) => {
      const historicalRow = rows.find(
        (candidate) =>
          candidate.rekrutacja === FORECAST_ROUND &&
          candidate.dziedzina_medycyny === specialty &&
          candidate.wojewodztwo === row.wojewodztwo,
      );
      return estimateFullProbability(historicalRow, priorRows);
    });
    for (const [outputField, sourceField] of Object.entries(forecastMappings)) {
      result[outputField] = round(mean(specialtyRows.map((row) => numeric(row[sourceField]))));
      result[`wazona_${outputField}`] = round(
        weightedMean(specialtyRows.map((row) => numeric(row[sourceField])), fillWeights),
      );
      result[`empiryczna_wazona_${outputField}`] = round(
        weightedMean(
          specialtyRows.map((row) => numeric(row[sourceField])),
          empiricalFillWeights,
        ),
      );
    }
    result.prognoza_krajowa_proc = result.empiryczna_wazona_prognoza_model_bez_egzaminu;
    return result;
  },
);
nationalForecasts.sort(
  (a, b) =>
    a.zakres_oceny.localeCompare(b.zakres_oceny, "pl") ||
    b.prognoza_model_laczony - a.prognoza_model_laczony,
);
writeCsv(nationalForecastFile, nationalForecasts, [
  "rekrutacja",
  "dziedzina_medycyny",
  "egzamin",
  "regiony_z_oferta",
  "historyczne_rundy_z_oferta",
  "historyczny_udzial_pelnych_pul",
  "zakres_oceny",
  "egzamin_sd_zrodlo",
  "oczekiwana_liczba_pelnych_pul",
  "prognoza_krajowa_proc",
  "prognoza_model_bez_egzaminu",
  "prognoza_model_z_egzaminem",
  "prognoza_model_z_egzaminem_i_sd",
  "prognoza_model_z_egzaminem_i_poprzednim_sd",
  "prognoza_model_kotwiczony_egzaminem",
  "prognoza_model_laczony",
  "wazona_prognoza_model_bez_egzaminu",
  "wazona_prognoza_model_z_egzaminem",
  "wazona_prognoza_model_z_egzaminem_i_sd",
  "wazona_prognoza_model_z_egzaminem_i_poprzednim_sd",
  "wazona_prognoza_model_kotwiczony_egzaminem",
  "wazona_prognoza_model_laczony",
  "empiryczna_wazona_prognoza_model_bez_egzaminu",
  "empiryczna_wazona_prognoza_model_z_egzaminem",
  "empiryczna_wazona_prognoza_model_z_egzaminem_i_sd",
  "empiryczna_wazona_prognoza_model_z_egzaminem_i_poprzednim_sd",
  "empiryczna_wazona_prognoza_model_kotwiczony_egzaminem",
  "empiryczna_wazona_prognoza_model_laczony",
]);

const strictHighConfidence = backtestRows.filter(
  (row) => row.scisly_stabilny_przed_runda === "TAK",
);
const depthThree = backtestRows.filter((row) => numeric(row.historyczne_pelne_pule) >= 3);
const nationalEvaluation = nationalBacktestRows.filter(
  (row) =>
    numeric(row.regiony_z_oferta) >= 3 &&
    numeric(row.regiony_z_pelna_pula) >= 3 &&
    numeric(row.udzial_pelnych_pul) >= 0.8,
);
const nationalAllFull = nationalEvaluation.filter((row) => row.udzial_pelnych_pul === 1);
const observedNationalEvaluation = nationalBacktestRows
  .filter(
    (row) =>
      numeric(row.regiony_z_oferta) >= 3 &&
      numeric(row.regiony_z_obserwowanym_wynikiem) >= 3 &&
      numeric(row.regiony_z_obserwowanym_wynikiem) / numeric(row.regiony_z_oferta) >= 0.8,
  )
  .map((row) => ({ ...row, rzeczywisty_prog: row.srednia_wszystkich_obserwowanych }));
const nationalEvaluationKeys = new Set(
  nationalEvaluation.map((row) => `${row.rekrutacja}::${row.dziedzina_medycyny}`),
);
const matchedRegionalRows = backtestRows.filter((row) =>
  nationalEvaluationKeys.has(`${row.rekrutacja}::${row.dziedzina_medycyny}`),
);

const report = {
  generated_at: new Date().toISOString(),
  model: {
    type: "ridge_regression",
    lambda: RIDGE_LAMBDA,
    exam_blend_weight: EXAM_BLEND_WEIGHT,
    target: "prog_min_proc dla pełnych pul miejsc",
    validation: "rolling-origin; każda runda jest przewidywana wyłącznie z wcześniejszych rund",
    historical_test_rounds: HISTORICAL_TEST_ROUNDS,
    numeric_features_without_exam: BASE_NUMERIC_FEATURES,
    additional_exam_features: EXAM_FEATURES,
    exam_sd_experimental_features: EXAM_SD_FEATURES,
    exam_sd_comparison_previous_features: EXAM_PREVIOUS_SD_FEATURES,
    exam_sd_feature_as_of_forecast: "odchylenie bieżącej sesji, gdy jest opublikowane; jesień 2026 tymczasowo korzysta z poprzedniej sesji",
    exam_anchored_features: EXAM_ANCHORED_FEATURES,
    categorical_features: ["dziedzina_medycyny", "wojewodztwo", "sezon", "egzamin"],
  },
  fill_model: {
    type: "ridge_logistic_regression",
    lambda: FILL_RIDGE_LAMBDA,
    target: "prawdopodobieństwo pełnego obsadzenia puli miejsc w województwie",
    validation: "rolling-origin; każda runda jest przewidywana wyłącznie z wcześniejszych rund",
    exam_features: "pominięte zgodnie z założeniem; model zapełnienia nie używa danych LEK/LDEK",
    numeric_features: FILL_NUMERIC_FEATURES,
    categorical_features: ["dziedzina_medycyny", "wojewodztwo", "sezon"],
    rows: fillBacktestRows.length,
    logistic: classificationMetrics(fillBacktestRows, "prawdopodobienstwo_model_logistyczny"),
    calibration: calibrationBins(fillBacktestRows, "prawdopodobienstwo_model_logistyczny"),
    smoothed_history_baseline: classificationMetrics(
      fillBacktestRows,
      "prawdopodobienstwo_wygladzona_historia",
    ),
    by_round: Object.fromEntries(
      HISTORICAL_TEST_ROUNDS.map((roundName) => {
        const roundRows = fillBacktestRows.filter((row) => row.rekrutacja === roundName);
        return [
          roundName,
          {
            rows: roundRows.length,
            logistic: classificationMetrics(roundRows, "prawdopodobienstwo_model_logistyczny"),
            smoothed_history_baseline: classificationMetrics(
              roundRows,
              "prawdopodobienstwo_wygladzona_historia",
            ),
          },
        ];
      }),
    ),
  },
  backtest: {
    rows: backtestRows.length,
    baseline_previous_threshold: metrics(backtestRows, "prognoza_poprzedni_prog"),
    ridge_without_exam: metrics(backtestRows, "prognoza_model_bez_egzaminu"),
    ridge_with_exam: metrics(backtestRows, "prognoza_model_z_egzaminem"),
    ridge_with_exam_and_current_sd: metrics(backtestRows, "prognoza_model_z_egzaminem_i_sd"),
    ridge_with_exam_and_previous_sd: metrics(backtestRows, "prognoza_model_z_egzaminem_i_poprzednim_sd"),
    exam_anchored_model: metrics(backtestRows, "prognoza_model_kotwiczony_egzaminem"),
    blended_model: metrics(backtestRows, "prognoza_model_laczony"),
    highest_confidence_pre_round: {
      definition: "Przed rundą: co najmniej 5 ofert, 4 pełne pule, udział pełnych >=70%, mediana przyjętych >=3 i mediana progu >=75%",
      rows: strictHighConfidence.length,
      rounds: Object.fromEntries(
        HISTORICAL_TEST_ROUNDS.map((name) => [
          name,
          strictHighConfidence.filter((row) => row.rekrutacja === name).length,
        ]),
      ),
      variants: compareModels(strictHighConfidence),
    },
    at_least_three_prior_full_rounds: {
      rows: depthThree.length,
      variants: compareModels(depthThree),
    },
    by_history_depth: {
      at_least_2_prior_full_rounds: metrics(
        backtestWithTwoRounds,
        "prognoza_model_laczony",
      ),
      at_least_3_prior_full_rounds: metrics(
        backtestWithThreeRounds,
        "prognoza_model_laczony",
      ),
    },
    by_exam: Object.fromEntries(
      ["LEK", "LDEK"].map((exam) => {
        const examRows = backtestRows.filter((row) => row.egzamin === exam);
        return [
          exam,
          {
            rows: examRows.length,
            baseline: metrics(examRows, "prognoza_poprzedni_prog"),
            ridge_without_exam: metrics(examRows, "prognoza_model_bez_egzaminu"),
            ridge_with_exam: metrics(examRows, "prognoza_model_z_egzaminem"),
            ridge_with_exam_and_current_sd: metrics(examRows, "prognoza_model_z_egzaminem_i_sd"),
            ridge_with_exam_and_previous_sd: metrics(examRows, "prognoza_model_z_egzaminem_i_poprzednim_sd"),
            exam_anchored_model: metrics(
              examRows,
              "prognoza_model_kotwiczony_egzaminem",
            ),
            blended_model: metrics(examRows, "prognoza_model_laczony"),
          },
        ];
      }),
    ),
    by_round: Object.fromEntries(
      HISTORICAL_TEST_ROUNDS.map((roundName) => {
        const roundRows = backtestRows.filter((row) => row.rekrutacja === roundName);
        return [
          roundName,
          {
            rows: roundRows.length,
            baseline: metrics(roundRows, "prognoza_poprzedni_prog"),
            ridge_without_exam: metrics(roundRows, "prognoza_model_bez_egzaminu"),
            ridge_with_exam: metrics(roundRows, "prognoza_model_z_egzaminem"),
            ridge_with_exam_and_current_sd: metrics(roundRows, "prognoza_model_z_egzaminem_i_sd"),
            ridge_with_exam_and_previous_sd: metrics(roundRows, "prognoza_model_z_egzaminem_i_poprzednim_sd"),
            exam_anchored_model: metrics(
              roundRows,
              "prognoza_model_kotwiczony_egzaminem",
            ),
            blended_model: metrics(roundRows, "prognoza_model_laczony"),
          },
        ];
      }),
    ),
  },
  national: {
    target: "Równa średnia progów województw z pełną pulą miejsc; województwo bez progu konkurencyjnego nie ma wartości do uśrednienia",
    prediction: "Równa średnia prognoz regionalnych we wszystkich województwach z ofertą; skład regionów znany przed rekrutacją",
    evaluation_filter: "Co najmniej 3 województwa z ofertą, 3 pełne pule i 80% udziału pełnych pul",
    selected_forecast: "empiryczna_wazona_prognoza_model_bez_egzaminu; nowy model logistyczny lepiej przewiduje zapełnienie, ale w tym małym krajowym backteście nie obniżył błędu agregowanego progu",
    test_rows: nationalEvaluation.length,
    by_round_rows: Object.fromEntries(
      HISTORICAL_TEST_ROUNDS.map((name) => [
        name,
        nationalEvaluation.filter((row) => row.rekrutacja === name).length,
      ]),
    ),
    variants: compareModels(nationalEvaluation),
    matched_regional_reference: {
      rows: matchedRegionalRows.length,
      note: "Te same tury specjalizacji, lecz tylko regionalne pełne pule z co najmniej jedną wcześniejszą pełną pulą; porównanie orientacyjne",
      variants: compareModels(matchedRegionalRows),
    },
    weighted_by_prior_full_probability: {
      method: "Regresja logistyczna ridge z cechami historii zapełnienia, wielkości puli, specjalizacji, województwa i sezonu; bez danych egzaminacyjnych; wyłącznie wcześniejsze rundy",
      variants: compareWeightedModels(nationalEvaluation),
      empirical_smoothing_baseline: compareEmpiricalWeightedModels(nationalEvaluation),
    },
    all_offered_regions_full: {
      rows: nationalAllFull.length,
      variants: compareModels(nationalAllFull),
      weighted_variants: compareWeightedModels(nationalAllFull),
    },
    all_observed_regional_minima: {
      definition: "Średnia najniższych wyników przyjętych ze wszystkich województw z obserwowanym wynikiem, także przy niepełnej puli; nie jest progiem konkurencyjnym",
      filter: "Co najmniej 3 województwa z ofertą i obserwowanym wynikiem oraz >=80% pokrycia ofert",
      rows: observedNationalEvaluation.length,
      variants: compareModels(observedNationalEvaluation),
      weighted_variants: compareWeightedModels(observedNationalEvaluation),
    },
    forecast_specialties: nationalForecasts.length,
    forecast_with_broader_history: nationalForecasts.filter(
      (row) => row.zakres_oceny === "szersze_pokrycie_historyczne",
    ).length,
  },
  forecast: {
    round: FORECAST_ROUND,
    rows: forecasts.length,
    stable_pilot_rows: forecasts.filter((row) => row.grupa_pilotazowa === "A_stabilny_pilotaz").length,
    high_threshold_small_pool_rows: forecasts.filter(
      (row) => row.grupa_pilotazowa === "B_wysoki_prog_mala_pula",
    ).length,
    interval_method: "prognoza modelu łączonego ± 80. percentyl bezwzględnego błędu w backteście",
    interval_error_p80: {
      low_confidence: errorP80Low,
      medium_confidence: errorP80Medium,
      high_confidence: errorP80High,
    },
  },
  limitations: [
    "Pełne obsadzenie miejsc jest wskaźnikiem zastępczym konkurencji.",
    "Dostępnych jest siedem zakończonych rund, więc wpływ egzaminu jest identyfikowany na niewielkiej liczbie zmian w czasie.",
    "Odchylenie z bieżącej sesji jest w archiwum CEM dostępne tylko do wiosny 2026; w prognozie jesieni 2026 używane jest odchylenie poprzedniej sesji.",
    "Przedział 80% jest empiryczny i wspólny dla wszystkich grup; kolejne wersje powinny kalibrować go według wielkości puli i historii.",
    "Krajowy backtest dotyczy tur z wysokim rzeczywistym udziałem pełnych pul; jest to warunkowa ocena i nie dowodzi takiej samej dokładności dla wszystkich specjalizacji.",
    "Krajowa prognoza uśrednia wszystkie regiony z ofertą, a historyczny cel tylko regiony z pełną pulą. Różnica składu może powodować obciążenie przy niepełnym obsadzeniu.",
    "Model zapełnienia przewiduje wskaźnik zastępczy pełnej puli, nie liczbę kandydatów ani faktyczny popyt; jakość zależy od poprawności liczby oferowanych miejsc i statusu obsadzenia.",
  ],
};
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Backtest: ${backtestRows.length} obserwacji.`);
console.log(`MAE bez egzaminu: ${report.backtest.ridge_without_exam.mae}.`);
console.log(`MAE z egzaminem: ${report.backtest.ridge_with_exam.mae}.`);
console.log(`MAE z egzaminem i bieżącym SD: ${report.backtest.ridge_with_exam_and_current_sd.mae}.`);
console.log(`MAE z egzaminem i poprzednim SD: ${report.backtest.ridge_with_exam_and_previous_sd.mae}.`);
console.log(`MAE modelu kotwiczonego egzaminem: ${report.backtest.exam_anchored_model.mae}.`);
console.log(`MAE modelu łączonego: ${report.backtest.blended_model.mae}.`);
console.log(`Prognoza ${FORECAST_ROUND}: ${forecasts.length} kombinacji.`);
console.log(`Najwyższa pewność przed rundą: ${strictHighConfidence.length} obserwacji.`);
console.log(`Krajowy backtest: ${nationalEvaluation.length} tur specjalizacji; prognozy: ${nationalForecasts.length}.`);
console.log(`Model zapełnienia: Brier ${report.fill_model.logistic.brier}; baza ${report.fill_model.smoothed_history_baseline.brier}.`);

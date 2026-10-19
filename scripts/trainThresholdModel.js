import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRankingExperiment } from "./rankingExperiment.js";
import { runFocusedThresholdModel } from "./focusedThresholdModel.js";
import { runSupplyScaleExperiment } from "./supplyScaleExperiment.js";
import { runTwoPartThresholdExperiment } from "./twoPartThresholdExperiment.js";

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
const geographyBacktestFile = path.join(dataDir, "geography_threshold_backtest.csv");
const geographyFillBacktestFile = path.join(dataDir, "geography_fill_backtest.csv");
const reportFile = path.join(dataDir, "threshold_model_report.json");

const ROUND_ORDER = ["w-2023", "j-2023", "w-2024", "j-2024", "w-2025", "j-2025", "w-2026", "j-2026"];
const RIDGE_LAMBDA = 20;
const FILL_RIDGE_LAMBDA = 2;
const EXAM_BLEND_WEIGHT = 0.25;
const TREND_DELTA_ENSEMBLE_WEIGHTS = {
  base: 0.6,
  seasonTrend: 0.2,
  delta: 0.2,
};
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

const SEASON_TREND_FEATURES = [
  ...BASE_NUMERIC_FEATURES,
  "trend_rundy_wiosna",
  "trend_rundy_jesien",
];

const DELTA_NUMERIC_FEATURES = [
  ...BASE_NUMERIC_FEATURES,
  "trend_rundy_wiosna",
  "trend_rundy_jesien",
  "ostatni_prog_tego_samego_sezonu",
];

const REGION_POOL_FEATURES = [
  ...SEASON_TREND_FEATURES,
  "sredni_prog_specjalizacji_grupy_wojewodztw_przed_runda",
  "liczba_prog_specjalizacji_grupy_wojewodztw_przed_runda",
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
const GEOGRAPHY_FEATURES = [
  "udzial_pojemnosci_duze_miasta",
  "udzial_pojemnosci_miasta_akademickie",
  "srednia_odleglosc_od_stolicy_km",
];
const GEOGRAPHY_VARIANTS = {
  duze_miasta: ["udzial_pojemnosci_duze_miasta"],
  miasta_akademickie: ["udzial_pojemnosci_miasta_akademickie"],
  odleglosc_od_stolicy: ["srednia_odleglosc_od_stolicy_km"],
  wszystkie_trzy: GEOGRAPHY_FEATURES,
};

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

function regionPeerGroup(region) {
  if (["Mazowieckie", "Dolnośląskie", "Małopolskie", "Pomorskie", "Wielkopolskie"].includes(region)) {
    return "duze_osrodki_hipoteza";
  }
  if (["Świętokrzyskie", "Podlaskie", "Łódzkie", "Lubelskie", "Podkarpackie"].includes(region)) {
    return "regiony_odplywowe_hipoteza";
  }
  return "pozostale";
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
    const competitiveCellSameSeason = competitiveCell.filter(
      (candidate) => candidate.sezon === row.sezon,
    );
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
    const peerGroup = regionPeerGroup(row.wojewodztwo);
    const competitiveSpecialtyPeerGroup = prior.filter(
      (candidate) =>
        candidate.dziedzina_medycyny === row.dziedzina_medycyny &&
        regionPeerGroup(candidate.wojewodztwo) === peerGroup &&
        isCompetitiveTarget(candidate),
    );
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
    const historicalNationalSpecialtyPlaces = [...new Set(
      prior
        .filter(
          (candidate) =>
            candidate.dziedzina_medycyny === row.dziedzina_medycyny &&
            numeric(candidate.oferowane_miejsca_rezydenckie) > 0,
        )
        .map((candidate) => candidate.rekrutacja),
    )].map((roundName) =>
      prior
        .filter(
          (candidate) =>
            candidate.rekrutacja === roundName &&
            candidate.dziedzina_medycyny === row.dziedzina_medycyny,
        )
        .reduce(
          (sum, candidate) => sum + (numeric(candidate.oferowane_miejsca_rezydenckie) ?? 0),
          0,
        ),
    );
    const typicalNationalSpecialtyPlaces = quantile(historicalNationalSpecialtyPlaces, 0.5);
    const historicalCellPlaces = sameCell
      .map((candidate) => numeric(candidate.oferowane_miejsca_rezydenckie))
      .filter((value) => value > 0);
    const typicalCellPlaces = quantile(historicalCellPlaces, 0.5);
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
      typowe_miejsca_kraj_specjalizacja_przed_runda: typicalNationalSpecialtyPlaces,
      log_relacja_miejsc_kraj_do_typowych:
        typicalNationalSpecialtyPlaces === null
          ? null
          : Math.log((nationalSpecialtyPlaces + 1) / (typicalNationalSpecialtyPlaces + 1)),
      typowe_miejsca_komorka_przed_runda: typicalCellPlaces,
      log_relacja_miejsc_komorka_do_typowych:
        places === null || typicalCellPlaces === null
          ? null
          : Math.log((places + 1) / (typicalCellPlaces + 1)),
      zmiana_miejsc: places !== null && previousPlaces !== null ? places - previousPlaces : null,
      poprzednie_miejsca: previousPlaces,
      poprzednio_zakwalifikowani: numeric(lastCell?.liczba_zakwalifikowanych),
      poprzednie_wypelnienie: numeric(lastCell?.wskaznik_wypelnienia),
      ostatni_obserwowany_wynik: numeric(observedCell.at(-1)?.prog_min_proc),
      ostatni_konkurencyjny_prog: numeric(competitiveCell.at(-1)?.prog_min_proc),
      ostatni_prog_tego_samego_sezonu: numeric(
        competitiveCellSameSeason.at(-1)?.prog_min_proc,
      ),
      kotwica_zmiany_progu:
        numeric(competitiveCellSameSeason.at(-1)?.prog_min_proc) ??
        numeric(competitiveCell.at(-1)?.prog_min_proc),
      trend_rundy_wiosna: row.sezon === "wiosenna" ? currentIndex : 0,
      trend_rundy_jesien: row.sezon === "jesienna" ? currentIndex : 0,
      grupa_wojewodztw_hipoteza: peerGroup,
      sredni_prog_specjalizacji_grupy_wojewodztw_przed_runda: mean(
        competitiveSpecialtyPeerGroup.map((candidate) => numeric(candidate.prog_min_proc)),
      ),
      liczba_prog_specjalizacji_grupy_wojewodztw_przed_runda:
        competitiveSpecialtyPeerGroup.length,
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

function logit(probability) {
  const bounded = clamp(probability, 1e-6, 1 - 1e-6);
  return Math.log(bounded / (1 - bounded));
}

function fitFillLogistic(trainRows, numericFeatures = FILL_NUMERIC_FEATURES) {
  const categoryFields = ["dziedzina_medycyny", "wojewodztwo", "sezon"];
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

function identityCalibrator() {
  return {
    intercept: 0,
    slope: 1,
    predict(probability) {
      return probability;
    },
  };
}

function stableHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildCrossFittedFillPredictions(trainingRows, foldCount = 5) {
  const taggedRows = trainingRows.map((row) => ({
    row,
    fold:
      stableHash(
        [row.rekrutacja, row.dziedzina_medycyny, row.wojewodztwo].join("::"),
      ) % foldCount,
  }));
  const predictions = [];
  const models = [];
  for (let fold = 0; fold < foldCount; fold += 1) {
    const foldTrainingRows = taggedRows
      .filter((candidate) => candidate.fold !== fold)
      .map((candidate) => candidate.row);
    const validationRows = taggedRows
      .filter((candidate) => candidate.fold === fold)
      .map((candidate) => candidate.row);
    if (!foldTrainingRows.length || !validationRows.length) continue;
    const foldModel = fitFillLogistic(foldTrainingRows);
    models.push(foldModel);
    for (const row of validationRows) {
      predictions.push({
        rawProbability: foldModel.predict(row),
        actual: fillTarget(row),
      });
    }
  }
  return { predictions, models };
}

function predictCalibratedFill(bundle, calibrator, row) {
  const ensembleProbability = mean(bundle.models.map((model) => model.predict(row)));
  return calibrator.predict(ensembleProbability);
}

function fitPlattCalibrator(calibrationRows) {
  if (calibrationRows.length < 50) return identityCalibrator();
  const predictors = calibrationRows.map((row) => logit(row.rawProbability));
  const predictorMean = mean(predictors);
  const predictorStandardDeviation =
    Math.sqrt(mean(predictors.map((value) => (value - predictorMean) ** 2))) || 1;
  const standardizedPredictors = predictors.map(
    (value) => (value - predictorMean) / predictorStandardDeviation,
  );
  const prevalence = clamp(mean(calibrationRows.map((row) => row.actual)), 0.001, 0.999);
  let intercept = logit(prevalence);
  let slope = 0;
  const slopePenalty = 1;

  function objective(candidateIntercept, candidateSlope) {
    let value = (slopePenalty * candidateSlope ** 2) / 2;
    for (let index = 0; index < calibrationRows.length; index += 1) {
      const probability = clamp(
        sigmoid(candidateIntercept + candidateSlope * standardizedPredictors[index]),
        1e-9,
        1 - 1e-9,
      );
      const actual = calibrationRows[index].actual;
      value -= actual * Math.log(probability) + (1 - actual) * Math.log(1 - probability);
    }
    return value;
  }

  for (let iteration = 0; iteration < 40; iteration += 1) {
    let gradientIntercept = 0;
    let gradientSlope = slopePenalty * (slope - 1);
    let hessianIntercept = 0;
    let hessianCross = 0;
    let hessianSlope = slopePenalty;
    for (let index = 0; index < calibrationRows.length; index += 1) {
      const row = calibrationRows[index];
      const predictor = standardizedPredictors[index];
      const probability = sigmoid(intercept + slope * predictor);
      const difference = probability - row.actual;
      const weight = Math.max(probability * (1 - probability), 1e-6);
      gradientIntercept += difference;
      gradientSlope += difference * predictor;
      hessianIntercept += weight;
      hessianCross += weight * predictor;
      hessianSlope += weight * predictor * predictor;
    }
    const determinant = hessianIntercept * hessianSlope - hessianCross ** 2;
    if (Math.abs(determinant) < 1e-12) break;
    const interceptStep =
      (gradientIntercept * hessianSlope - gradientSlope * hessianCross) / determinant;
    const slopeStep =
      (gradientSlope * hessianIntercept - gradientIntercept * hessianCross) / determinant;
    const currentObjective = objective(intercept, slope);
    let stepScale = 1;
    while (
      stepScale > 1e-6 &&
      objective(intercept - stepScale * interceptStep, slope - stepScale * slopeStep) >
        currentObjective
    ) {
      stepScale /= 2;
    }
    intercept -= stepScale * interceptStep;
    slope -= stepScale * slopeStep;
    if (stepScale <= 1e-6 || Math.max(Math.abs(interceptStep), Math.abs(slopeStep)) * stepScale < 1e-7) {
      break;
    }
  }
  return {
    intercept,
    slope,
    predict(probability) {
      const standardizedPredictor = clamp(
        (logit(probability) - predictorMean) / predictorStandardDeviation,
        -8,
        8,
      );
      return sigmoid(intercept + slope * standardizedPredictor);
    },
  };
}

function fitIsotonicCalibrator(calibrationRows, requestedBinCount = 10) {
  if (calibrationRows.length < 50) return { ...identityCalibrator(), method: "identity", points: [] };
  const sorted = [...calibrationRows].sort(
    (left, right) => left.rawProbability - right.rawProbability,
  );
  const binCount = Math.min(requestedBinCount, Math.floor(sorted.length / 50));
  const shrinkage = 30;
  const blocks = [];
  for (let bin = 0; bin < binCount; bin += 1) {
    const start = Math.floor((bin * sorted.length) / binCount);
    const end = Math.floor(((bin + 1) * sorted.length) / binCount);
    const binRows = sorted.slice(start, end);
    const rawMean = mean(binRows.map((row) => row.rawProbability));
    const actualMean = mean(binRows.map((row) => row.actual));
    const calibratedMean =
      (binRows.length * actualMean + shrinkage * rawMean) / (binRows.length + shrinkage);
    blocks.push({ x: rawMean, y: calibratedMean, weight: binRows.length });
    while (blocks.length >= 2 && blocks.at(-2).y > blocks.at(-1).y) {
      const right = blocks.pop();
      const left = blocks.pop();
      const totalWeight = left.weight + right.weight;
      blocks.push({
        x: (left.x * left.weight + right.x * right.weight) / totalWeight,
        y: (left.y * left.weight + right.y * right.weight) / totalWeight,
        weight: totalWeight,
      });
    }
  }
  return {
    method: "isotonic_binned_shrunk",
    points: blocks.map((block) => ({
      raw_probability: round(block.x, 6),
      calibrated_probability: round(block.y, 6),
      n: block.weight,
    })),
    predict(probability) {
      if (probability <= blocks[0].x) return clamp(blocks[0].y, 0.001, 0.999);
      if (probability >= blocks.at(-1).x) return clamp(blocks.at(-1).y, 0.001, 0.999);
      for (let index = 1; index < blocks.length; index += 1) {
        if (probability <= blocks[index].x) {
          const left = blocks[index - 1];
          const right = blocks[index];
          const share = (probability - left.x) / (right.x - left.x || 1);
          return clamp(left.y + share * (right.y - left.y), 0.001, 0.999);
        }
      }
      return clamp(probability, 0.001, 0.999);
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

function deltaPrediction(row, trainRows, deltaModel, fallbackPrediction = null) {
  const anchor = numeric(row.kotwica_zmiany_progu);
  if (anchor !== null) return clamp(anchor + deltaModel.predict(row));
  if (Number.isFinite(fallbackPrediction)) return fallbackPrediction;
  return baselinePrediction(row, trainRows);
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
  sezon_trend: "prognoza_model_sezon_trend",
  zmiana_progu: "prognoza_model_zmiana_progu",
  sezon_trend_regiony: "prognoza_model_sezon_trend_regiony",
  trend_delta_laczony: "prognoza_model_trend_delta_laczony",
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
  const calibrationError = Array.from({ length: 10 }, (_, index) => {
    const minimum = index / 10;
    const maximum = (index + 1) / 10;
    const bin = observations.filter(
      ({ probability }) =>
        probability >= minimum && (index === 9 ? probability <= maximum : probability < maximum),
    );
    if (!bin.length) return 0;
    return (
      (bin.length / observations.length) *
      Math.abs(
        mean(bin.map(({ probability }) => probability)) -
          mean(bin.map(({ actual }) => actual)),
      )
    );
  }).reduce((sum, value) => sum + value, 0);
  return {
    n: observations.length,
    observed_rate: round(mean(observations.map(({ actual }) => actual))),
    mean_probability: round(mean(observations.map(({ probability }) => probability))),
    brier: round(brier, 4),
    log_loss: round(logLoss, 4),
    auc: round(pairScore, 4),
    expected_calibration_error_10_bins: round(calibrationError, 4),
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
  const seasonTrend = models.seasonTrend.predict(row);
  const regionPool = models.regionPool.predict(row);
  const delta = deltaPrediction(row, trainRows, models.delta, seasonTrend);
  const trendDeltaEnsemble =
    TREND_DELTA_ENSEMBLE_WEIGHTS.base * withoutExam +
    TREND_DELTA_ENSEMBLE_WEIGHTS.seasonTrend * seasonTrend +
    TREND_DELTA_ENSEMBLE_WEIGHTS.delta * delta;
  const withExam = models.withExam.predict(row);
  const withSd = models.withExamAndSd.predict(row);
  const withPreviousSd = models.withExamAndPreviousSd.predict(row);
  return {
    prognoza_poprzedni_prog: baselinePrediction(row, trainRows),
    prognoza_model_bez_egzaminu: withoutExam,
    prognoza_model_sezon_trend: seasonTrend,
    prognoza_model_zmiana_progu: delta,
    prognoza_model_sezon_trend_regiony: regionPool,
    prognoza_model_trend_delta_laczony: trendDeltaEnsemble,
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
const geographyBacktestRows = [];
const geographyFillBacktestRows = [];
const fillModelsByRound = new Map();
const fillCalibrationRowsByRound = new Map();

for (let testIndex = 2; testIndex <= roundIndex.get(FORECAST_ROUND); testIndex += 1) {
  const testRound = ROUND_ORDER[testIndex];
  const trainingRows = rows.filter(
    (row) => roundIndex.get(row.rekrutacja) < testIndex && isFillObservation(row),
  );
  if (!trainingRows.length) continue;
  const model = fitFillLogistic(trainingRows);
  fillModelsByRound.set(testRound, model);
  if (testIndex >= 3) {
    fillCalibrationRowsByRound.set(
      testRound,
      buildCrossFittedFillPredictions(trainingRows),
    );
  }
}

for (const testRound of HISTORICAL_TEST_ROUNDS) {
  const testIndex = roundIndex.get(testRound);
  const hasGeography = (row) =>
    numeric(row.pokrycie_geografii) >= 0.95 &&
    GEOGRAPHY_FEATURES.every((feature) => numeric(row[feature]) !== null);
  const trainRows = rows.filter(
    (row) =>
      roundIndex.get(row.rekrutacja) < testIndex && isCompetitiveTarget(row) && hasGeography(row),
  );
  const testRows = rows.filter(
    (row) =>
      row.rekrutacja === testRound &&
      isCompetitiveTarget(row) &&
      row.liczba_historycznych_pelnych_pul >= 1 &&
      hasGeography(row),
  );
  if (!trainRows.length || !testRows.length) continue;
  const baselineModel = fitRidge(trainRows, BASE_NUMERIC_FEATURES);
  const geographyModels = Object.fromEntries(
    Object.entries(GEOGRAPHY_VARIANTS).map(([name, features]) => [
      name,
      fitRidge(trainRows, [...BASE_NUMERIC_FEATURES, ...features]),
    ]),
  );
  for (const row of testRows) {
    const baseline = baselineModel.predict(row);
    const geographyPredictions = Object.fromEntries(
      Object.entries(geographyModels).map(([name, model]) => [name, model.predict(row)]),
    );
    const geography = geographyPredictions.wszystkie_trzy;
    geographyBacktestRows.push({
      rekrutacja: testRound,
      wojewodztwo: row.wojewodztwo,
      dziedzina_medycyny: row.dziedzina_medycyny,
      egzamin: row.egzamin,
      historyczne_pelne_pule: row.liczba_historycznych_pelnych_pul,
      scisly_stabilny_przed_runda: row.scisly_stabilny_przed_runda ? "TAK" : "NIE",
      rzeczywisty_prog: round(row.target),
      udzial_pojemnosci_duze_miasta: round(row.udzial_pojemnosci_duze_miasta, 6),
      udzial_pojemnosci_miasta_akademickie: round(
        row.udzial_pojemnosci_miasta_akademickie,
        6,
      ),
      srednia_odleglosc_od_stolicy_km: round(row.srednia_odleglosc_od_stolicy_km),
      prognoza_bazowa_ten_sam_zbior: round(baseline),
      prognoza_duze_miasta: round(geographyPredictions.duze_miasta),
      prognoza_miasta_akademickie: round(geographyPredictions.miasta_akademickie),
      prognoza_odleglosc_od_stolicy: round(geographyPredictions.odleglosc_od_stolicy),
      prognoza_z_geografia: round(geography),
      blad_bazowy: round(Math.abs(baseline - row.target)),
      blad_z_geografia: round(Math.abs(geography - row.target)),
    });
  }
}

for (const testRound of HISTORICAL_TEST_ROUNDS) {
  const testIndex = roundIndex.get(testRound);
  const hasGeography = (row) =>
    numeric(row.pokrycie_geografii) >= 0.95 &&
    GEOGRAPHY_FEATURES.every((feature) => numeric(row[feature]) !== null);
  const trainRows = rows.filter(
    (row) => roundIndex.get(row.rekrutacja) < testIndex && isFillObservation(row) && hasGeography(row),
  );
  const testRows = rows.filter(
    (row) => row.rekrutacja === testRound && isFillObservation(row) && hasGeography(row),
  );
  if (!trainRows.length || !testRows.length) continue;
  const baselineModel = fitFillLogistic(trainRows);
  const geographyModel = fitFillLogistic(trainRows, [...FILL_NUMERIC_FEATURES, ...GEOGRAPHY_FEATURES]);
  for (const row of testRows) {
    geographyFillBacktestRows.push({
      rekrutacja: testRound,
      wojewodztwo: row.wojewodztwo,
      dziedzina_medycyny: row.dziedzina_medycyny,
      czy_pelna_pula: fillTarget(row),
      prawdopodobienstwo_bazowe: round(baselineModel.predict(row), 6),
      prawdopodobienstwo_z_geografia: round(geographyModel.predict(row), 6),
    });
  }
}

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
  const seasonTrend = fitRidge(trainRows, SEASON_TREND_FEATURES);
  const deltaTrainingRows = trainRows
    .filter((row) => numeric(row.kotwica_zmiany_progu) !== null)
    .map((row) => ({
      ...row,
      target: row.target - numeric(row.kotwica_zmiany_progu),
    }));
  const delta = fitRidge(deltaTrainingRows, DELTA_NUMERIC_FEATURES);
  const regionPool = fitRidge(trainRows, REGION_POOL_FEATURES);
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
  const foldModels = {
    withoutExam,
    seasonTrend,
    delta,
    regionPool,
    withExam,
    withExamAndSd,
    withExamAndPreviousSd,
    examAnchored,
  };
  const fillModel = fillModelsByRound.get(testRound);
  const fillCalibrationBundle = fillCalibrationRowsByRound.get(testRound) ?? {
    predictions: [],
    models: [fillModel],
  };
  const calibrationTrainingRows = fillCalibrationBundle.predictions;
  const fillCalibrator = fitIsotonicCalibrator(calibrationTrainingRows);
  const priorToRound = rawRows.filter(
    (candidate) => roundIndex.get(candidate.rekrutacja) < testIndex,
  );
  for (const row of fillTestRows) {
    const rawFillProbability = fillModel.predict(row);
    fillBacktestRows.push({
      rekrutacja: testRound,
      wojewodztwo: row.wojewodztwo,
      dziedzina_medycyny: row.dziedzina_medycyny,
      egzamin: row.egzamin,
      liczba_miejsc: row.oferowane_miejsca_rezydenckie,
      czy_pelna_pula: fillTarget(row),
      prawdopodobienstwo_model_logistyczny: round(rawFillProbability, 6),
      prawdopodobienstwo_model_skalibrowany: round(
        predictCalibratedFill(fillCalibrationBundle, fillCalibrator, row),
        6,
      ),
      liczba_obserwacji_kalibracyjnych: calibrationTrainingRows.length,
      kalibrator_metoda: fillCalibrator.method,
      kalibrator_wyraz_wolny: round(fillCalibrator.intercept, 6),
      kalibrator_nachylenie: round(fillCalibrator.slope, 6),
      prawdopodobienstwo_wygladzona_historia: round(
        estimateFullProbability(row, priorToRound),
        6,
      ),
    });
  }
  for (const row of testRows) {
    const baseline = baselinePrediction(row, trainRows);
    const predictionWithoutExam = withoutExam.predict(row);
    const predictionSeasonTrend = seasonTrend.predict(row);
    const predictionDelta = deltaPrediction(row, trainRows, delta, predictionSeasonTrend);
    const predictionRegionPool = regionPool.predict(row);
    const predictionTrendDeltaEnsemble =
      TREND_DELTA_ENSEMBLE_WEIGHTS.base * predictionWithoutExam +
      TREND_DELTA_ENSEMBLE_WEIGHTS.seasonTrend * predictionSeasonTrend +
      TREND_DELTA_ENSEMBLE_WEIGHTS.delta * predictionDelta;
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
      prognoza_model_sezon_trend: round(predictionSeasonTrend),
      prognoza_model_zmiana_progu: round(predictionDelta),
      prognoza_model_sezon_trend_regiony: round(predictionRegionPool),
      prognoza_model_trend_delta_laczony: round(predictionTrendDeltaEnsemble),
      prognoza_model_z_egzaminem: round(predictionWithExam),
      prognoza_model_z_egzaminem_i_sd: round(predictionWithExamAndSd),
      prognoza_model_z_egzaminem_i_poprzednim_sd: round(predictionWithExamAndPreviousSd),
      prognoza_model_kotwiczony_egzaminem: round(predictionExamAnchored),
      prognoza_model_laczony: round(ensemblePrediction),
      blad_bezwzgledny_poprzedni_prog: round(Math.abs(baseline - row.target)),
      blad_bezwzgledny_bez_egzaminu: round(Math.abs(predictionWithoutExam - row.target)),
      blad_bezwzgledny_sezon_trend: round(Math.abs(predictionSeasonTrend - row.target)),
      blad_bezwzgledny_zmiana_progu: round(Math.abs(predictionDelta - row.target)),
      blad_bezwzgledny_sezon_trend_regiony: round(
        Math.abs(predictionRegionPool - row.target),
      ),
      blad_bezwzgledny_trend_delta_laczony: round(
        Math.abs(predictionTrendDeltaEnsemble - row.target),
      ),
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
  "prognoza_model_sezon_trend",
  "prognoza_model_zmiana_progu",
  "prognoza_model_sezon_trend_regiony",
  "prognoza_model_trend_delta_laczony",
  "prognoza_model_trend_delta_laczony",
  "prognoza_model_z_egzaminem",
  "prognoza_model_z_egzaminem_i_sd",
  "prognoza_model_z_egzaminem_i_poprzednim_sd",
  "prognoza_model_kotwiczony_egzaminem",
  "prognoza_model_laczony",
  "blad_bezwzgledny_poprzedni_prog",
  "blad_bezwzgledny_bez_egzaminu",
  "blad_bezwzgledny_sezon_trend",
  "blad_bezwzgledny_zmiana_progu",
  "blad_bezwzgledny_sezon_trend_regiony",
  "blad_bezwzgledny_trend_delta_laczony",
  "blad_bezwzgledny_z_egzaminem",
  "blad_bezwzgledny_z_egzaminem_i_sd",
  "blad_bezwzgledny_z_egzaminem_i_poprzednim_sd",
  "blad_bezwzgledny_model_kotwiczony_egzaminem",
  "blad_bezwzgledny_model_laczony",
];
writeCsv(backtestFile, backtestRows, backtestColumns);
writeCsv(geographyBacktestFile, geographyBacktestRows, [
  "rekrutacja",
  "wojewodztwo",
  "dziedzina_medycyny",
  "egzamin",
  "historyczne_pelne_pule",
  "scisly_stabilny_przed_runda",
  "rzeczywisty_prog",
  "udzial_pojemnosci_duze_miasta",
  "udzial_pojemnosci_miasta_akademickie",
  "srednia_odleglosc_od_stolicy_km",
  "prognoza_bazowa_ten_sam_zbior",
  "prognoza_duze_miasta",
  "prognoza_miasta_akademickie",
  "prognoza_odleglosc_od_stolicy",
  "prognoza_z_geografia",
  "blad_bazowy",
  "blad_z_geografia",
]);
writeCsv(geographyFillBacktestFile, geographyFillBacktestRows, [
  "rekrutacja",
  "wojewodztwo",
  "dziedzina_medycyny",
  "czy_pelna_pula",
  "prawdopodobienstwo_bazowe",
  "prawdopodobienstwo_z_geografia",
]);

writeCsv(fillBacktestFile, fillBacktestRows, [
  "rekrutacja",
  "wojewodztwo",
  "dziedzina_medycyny",
  "egzamin",
  "liczba_miejsc",
  "czy_pelna_pula",
  "prawdopodobienstwo_model_logistyczny",
  "prawdopodobienstwo_model_skalibrowany",
  "liczba_obserwacji_kalibracyjnych",
  "kalibrator_metoda",
  "kalibrator_wyraz_wolny",
  "kalibrator_nachylenie",
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
const finalSeasonTrend = fitRidge(historicalTrainingRows, SEASON_TREND_FEATURES);
const finalDeltaTrainingRows = historicalTrainingRows
  .filter((row) => numeric(row.kotwica_zmiany_progu) !== null)
  .map((row) => ({
    ...row,
    target: row.target - numeric(row.kotwica_zmiany_progu),
  }));
const finalDelta = fitRidge(finalDeltaTrainingRows, DELTA_NUMERIC_FEATURES);
const finalRegionPool = fitRidge(historicalTrainingRows, REGION_POOL_FEATURES);
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
const finalFillModel = fillModelsByRound.get(FORECAST_ROUND);
const finalFillCalibrationBundle = fillCalibrationRowsByRound.get(FORECAST_ROUND) ?? {
  predictions: [],
  models: [finalFillModel],
};
const finalFillCalibrationRows = finalFillCalibrationBundle.predictions;
const finalFillCalibrator = fitIsotonicCalibrator(finalFillCalibrationRows);
const backtestWithTwoRounds = backtestRows.filter((row) => numeric(row.historyczne_pelne_pule) >= 2);
const backtestWithThreeRounds = backtestRows.filter((row) => numeric(row.historyczne_pelne_pule) >= 3);
const errorP80Low = metrics(backtestRows, "prognoza_model_trend_delta_laczony").error_p80;
const errorP80Medium = metrics(
  backtestWithTwoRounds,
  "prognoza_model_trend_delta_laczony",
).error_p80;
const errorP80High = metrics(
  backtestWithThreeRounds,
  "prognoza_model_trend_delta_laczony",
).error_p80;
const forecasts = futureRows.map((row) => {
  const predictionWithoutExam = finalWithoutExam.predict(row);
  const predictionSeasonTrend = finalSeasonTrend.predict(row);
  const predictionDelta = deltaPrediction(
    row,
    historicalTrainingRows,
    finalDelta,
    predictionSeasonTrend,
  );
  const predictionRegionPool = finalRegionPool.predict(row);
  const predictionTrendDeltaEnsemble =
    TREND_DELTA_ENSEMBLE_WEIGHTS.base * predictionWithoutExam +
    TREND_DELTA_ENSEMBLE_WEIGHTS.seasonTrend * predictionSeasonTrend +
    TREND_DELTA_ENSEMBLE_WEIGHTS.delta * predictionDelta;
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
  const rawFillProbability = finalFillModel.predict(row);
  const experimentalCalibratedFillProbability = predictCalibratedFill(
    finalFillCalibrationBundle,
    finalFillCalibrator,
    row,
  );
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
    prawdopodobienstwo_pelnej_puli_surowe: round(rawFillProbability, 6),
    prawdopodobienstwo_pelnej_puli_skalibrowane_eksperymentalne: round(
      experimentalCalibratedFillProbability,
      6,
    ),
    prawdopodobienstwo_pelnej_puli: round(rawFillProbability, 6),
    prognoza_bez_egzaminu: round(predictionWithoutExam),
    prognoza_sezon_trend: round(predictionSeasonTrend),
    prognoza_zmiana_progu: round(predictionDelta),
    prognoza_sezon_trend_regiony: round(predictionRegionPool),
    prognoza_trend_delta_laczony: round(predictionTrendDeltaEnsemble),
    prognoza_z_egzaminem: round(predictionWithExam),
    prognoza_z_egzaminem_i_sd: round(predictionWithExamAndSd),
    prognoza_z_egzaminem_i_poprzednim_sd: round(predictionWithExamAndPreviousSd),
    prognoza_kotwiczona_egzaminem: round(predictionExamAnchored),
    prognoza_laczona_z_egzaminem: round(ensemblePrediction),
    prognoza_modelowa: round(predictionTrendDeltaEnsemble),
    dolna_granica_80_proc: round(clamp(predictionTrendDeltaEnsemble - intervalError)),
    gorna_granica_80_proc: round(clamp(predictionTrendDeltaEnsemble + intervalError)),
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
  "prawdopodobienstwo_pelnej_puli_surowe",
  "prawdopodobienstwo_pelnej_puli_skalibrowane_eksperymentalne",
  "prawdopodobienstwo_pelnej_puli",
  "prognoza_bez_egzaminu",
  "prognoza_sezon_trend",
  "prognoza_zmiana_progu",
  "prognoza_sezon_trend_regiony",
  "prognoza_trend_delta_laczony",
  "prognoza_z_egzaminem",
  "prognoza_z_egzaminem_i_sd",
  "prognoza_z_egzaminem_i_poprzednim_sd",
  "prognoza_kotwiczona_egzaminem",
  "prognoza_laczona_z_egzaminem",
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
    "prawdopodobienstwo_pelnej_puli_surowe",
    "prawdopodobienstwo_pelnej_puli_skalibrowane_eksperymentalne",
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
      prognoza_model_sezon_trend: "prognoza_sezon_trend",
      prognoza_model_zmiana_progu: "prognoza_zmiana_progu",
      prognoza_model_sezon_trend_regiony: "prognoza_sezon_trend_regiony",
      prognoza_model_trend_delta_laczony: "prognoza_trend_delta_laczony",
      prognoza_model_z_egzaminem: "prognoza_z_egzaminem",
      prognoza_model_z_egzaminem_i_sd: "prognoza_z_egzaminem_i_sd",
      prognoza_model_z_egzaminem_i_poprzednim_sd: "prognoza_z_egzaminem_i_poprzednim_sd",
      prognoza_model_kotwiczony_egzaminem: "prognoza_kotwiczona_egzaminem",
      prognoza_model_laczony: "prognoza_laczona_z_egzaminem",
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
    result.prognoza_krajowa_proc =
      result.empiryczna_wazona_prognoza_model_trend_delta_laczony;
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
  "prognoza_model_sezon_trend",
  "prognoza_model_zmiana_progu",
  "prognoza_model_sezon_trend_regiony",
  "prognoza_model_z_egzaminem",
  "prognoza_model_z_egzaminem_i_sd",
  "prognoza_model_z_egzaminem_i_poprzednim_sd",
  "prognoza_model_kotwiczony_egzaminem",
  "prognoza_model_laczony",
  "wazona_prognoza_model_bez_egzaminu",
  "wazona_prognoza_model_sezon_trend",
  "wazona_prognoza_model_zmiana_progu",
  "wazona_prognoza_model_sezon_trend_regiony",
  "wazona_prognoza_model_trend_delta_laczony",
  "wazona_prognoza_model_z_egzaminem",
  "wazona_prognoza_model_z_egzaminem_i_sd",
  "wazona_prognoza_model_z_egzaminem_i_poprzednim_sd",
  "wazona_prognoza_model_kotwiczony_egzaminem",
  "wazona_prognoza_model_laczony",
  "empiryczna_wazona_prognoza_model_bez_egzaminu",
  "empiryczna_wazona_prognoza_model_sezon_trend",
  "empiryczna_wazona_prognoza_model_zmiana_progu",
  "empiryczna_wazona_prognoza_model_sezon_trend_regiony",
  "empiryczna_wazona_prognoza_model_trend_delta_laczony",
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
const geographyHighConfidence = geographyBacktestRows.filter(
  (row) => row.scisly_stabilny_przed_runda === "TAK",
);

const report = {
  two_part_experiment: runTwoPartThresholdExperiment({
    root, rows, roundOrder: ROUND_ORDER, testRounds: HISTORICAL_TEST_ROUNDS,
    forecastRound: FORECAST_ROUND, fitRidge, baseFeatures: BASE_NUMERIC_FEATURES,
    isCompetitiveTarget, fillModelsByRound, backtestRows, forecasts, writeCsv,
    metrics, round, numeric,
  }),
  supply_scale_experiment: runSupplyScaleExperiment({
    root, rows, roundOrder: ROUND_ORDER, testRounds: HISTORICAL_TEST_ROUNDS,
    forecastRound: FORECAST_ROUND, fitRidge, baseFeatures: BASE_NUMERIC_FEATURES,
    isCompetitiveTarget, backtestRows, forecasts, writeCsv, metrics, round, numeric,
  }),
  focused_specialties: runFocusedThresholdModel({
    root, rows, roundOrder: ROUND_ORDER, testRounds: HISTORICAL_TEST_ROUNDS,
    forecastRound: FORECAST_ROUND, fitRidge, baseFeatures: BASE_NUMERIC_FEATURES,
    isCompetitiveTarget, backtestRows, forecasts, writeCsv, metrics, round,
  }),
  ranking_experiment: runRankingExperiment({
    root, rows, rawRows, readCsv, numeric, quantile, mean, round, groupBy,
    fitRidge, baseFeatures: BASE_NUMERIC_FEATURES, roundOrder: ROUND_ORDER,
    testRounds: HISTORICAL_TEST_ROUNDS, isCompetitiveTarget, backtestRows,
    nationalEvaluation, estimateFullProbability, weightedMean, writeCsv, metrics,
    forecastRound: FORECAST_ROUND,
  }),
  generated_at: new Date().toISOString(),
  model: {
    type: "ridge_regression",
    lambda: RIDGE_LAMBDA,
    exam_blend_weight: EXAM_BLEND_WEIGHT,
    target: "prog_min_proc dla pełnych pul miejsc",
    validation: "rolling-origin; każda runda jest przewidywana wyłącznie z wcześniejszych rund",
    historical_test_rounds: HISTORICAL_TEST_ROUNDS,
    numeric_features_without_exam: BASE_NUMERIC_FEATURES,
    season_trend_features: SEASON_TREND_FEATURES,
    delta_features: DELTA_NUMERIC_FEATURES,
    delta_anchor: "ostatni konkurencyjny próg z tego samego sezonu; w razie braku ostatni konkurencyjny próg dowolnego sezonu",
    region_pool_features: REGION_POOL_FEATURES,
    trend_delta_ensemble_weights: TREND_DELTA_ENSEMBLE_WEIGHTS,
    trend_delta_ensemble_note: "Eksploracyjna średnia ważona prognoz: poziom bazowy 60%, sezon × trend 20%, zmiana progu 20%; wagi wybrane po porównaniu wariantów i wymagają potwierdzenia na nowych rundach",
    region_peer_groups_experimental: {
      duze_osrodki_hipoteza: ["Mazowieckie", "Dolnośląskie", "Małopolskie", "Pomorskie", "Wielkopolskie"],
      regiony_odplywowe_hipoteza: ["Świętokrzyskie", "Podlaskie", "Łódzkie", "Lubelskie", "Podkarpackie"],
      pozostale: "pozostałe województwa",
    },
    additional_exam_features: EXAM_FEATURES,
    exam_sd_experimental_features: EXAM_SD_FEATURES,
    exam_sd_comparison_previous_features: EXAM_PREVIOUS_SD_FEATURES,
    exam_sd_feature_as_of_forecast: "odchylenie bieżącej sesji, gdy jest opublikowane; jesień 2026 tymczasowo korzysta z poprzedniej sesji",
    exam_anchored_features: EXAM_ANCHORED_FEATURES,
    categorical_features: ["dziedzina_medycyny", "wojewodztwo", "sezon", "egzamin"],
  },
  geography_experiment: {
    status: "diagnostyczny; nie zmienia wariantu produkcyjnego",
    provinces: ["Dolnośląskie", "Mazowieckie", "Warmińsko-mazurskie"],
    validation: "rolling-origin, oba warianty trenowane i oceniane na identycznych rekordach z pokryciem geograficznym >=95%",
    features: GEOGRAPHY_FEATURES,
    rows: geographyBacktestRows.length,
    baseline_same_subset: metrics(geographyBacktestRows, "prognoza_bazowa_ten_sam_zbior"),
    variants: {
      large_city_share: metrics(geographyBacktestRows, "prognoza_duze_miasta"),
      academic_city_share: metrics(geographyBacktestRows, "prognoza_miasta_akademickie"),
      distance_from_capital: metrics(geographyBacktestRows, "prognoza_odleglosc_od_stolicy"),
      all_three: metrics(geographyBacktestRows, "prognoza_z_geografia"),
    },
    with_geography: metrics(geographyBacktestRows, "prognoza_z_geografia"),
    highest_confidence_pre_round: {
      rows: geographyHighConfidence.length,
      baseline_same_subset: metrics(
        geographyHighConfidence,
        "prognoza_bazowa_ten_sam_zbior",
      ),
      with_geography: metrics(geographyHighConfidence, "prognoza_z_geografia"),
      variants: {
        large_city_share: metrics(geographyHighConfidence, "prognoza_duze_miasta"),
        academic_city_share: metrics(
          geographyHighConfidence,
          "prognoza_miasta_akademickie",
        ),
        distance_from_capital: metrics(
          geographyHighConfidence,
          "prognoza_odleglosc_od_stolicy",
        ),
        all_three: metrics(geographyHighConfidence, "prognoza_z_geografia"),
      },
    },
    by_round: Object.fromEntries(
      HISTORICAL_TEST_ROUNDS.map((roundName) => {
        const roundRows = geographyBacktestRows.filter((row) => row.rekrutacja === roundName);
        return [
          roundName,
          {
            rows: roundRows.length,
            baseline_same_subset: metrics(roundRows, "prognoza_bazowa_ten_sam_zbior"),
            with_geography: metrics(roundRows, "prognoza_z_geografia"),
          },
        ];
      }),
    ),
    caveat: "Pojemność placówek jest rozkładem możliwości szkoleniowych, nie liczbą miejsc rezydenckich w rundzie.",
    fill_probability: {
      rows: geographyFillBacktestRows.length,
      baseline_same_subset: classificationMetrics(
        geographyFillBacktestRows,
        "prawdopodobienstwo_bazowe",
      ),
      with_geography: classificationMetrics(
        geographyFillBacktestRows,
        "prawdopodobienstwo_z_geografia",
      ),
    },
  },
  fill_model: {
    type: "ridge_logistic_regression",
    lambda: FILL_RIDGE_LAMBDA,
    target: "prawdopodobieństwo pełnego obsadzenia puli miejsc w województwie",
    validation: "rolling-origin; każda runda jest przewidywana wyłącznie z wcześniejszych rund",
    exam_features: "pominięte zgodnie z założeniem; model zapełnienia nie używa danych LEK/LDEK",
    selected_probability: "prawdopodobienstwo_model_logistyczny (surowe); testowane kalibracje pogarszały Brier score i ECE w walidacji rolling-origin, więc nie zastępują głównej prognozy",
    numeric_features: FILL_NUMERIC_FEATURES,
    categorical_features: ["dziedzina_medycyny", "wojewodztwo", "sezon"],
    rows: fillBacktestRows.length,
    logistic_raw: classificationMetrics(fillBacktestRows, "prawdopodobienstwo_model_logistyczny"),
    logistic_calibrated: classificationMetrics(
      fillBacktestRows,
      "prawdopodobienstwo_model_skalibrowany",
    ),
    calibration_raw: calibrationBins(fillBacktestRows, "prawdopodobienstwo_model_logistyczny"),
    calibration_after_experimental_isotonic: calibrationBins(
      fillBacktestRows,
      "prawdopodobienstwo_model_skalibrowany",
    ),
    final_calibrator: {
      method: "Monotoniczna kalibracja przedziałowa na prognozach cross-fitted z wcześniejszych rund, z wygładzaniem do surowego prawdopodobieństwa",
      training_rows: finalFillCalibrationRows.length,
      points: finalFillCalibrator.points,
    },
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
            logistic_raw: classificationMetrics(
              roundRows,
              "prawdopodobienstwo_model_logistyczny",
            ),
            logistic_calibrated: classificationMetrics(
              roundRows,
              "prawdopodobienstwo_model_skalibrowany",
            ),
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
    ridge_season_trend: metrics(backtestRows, "prognoza_model_sezon_trend"),
    ridge_delta_threshold: metrics(backtestRows, "prognoza_model_zmiana_progu"),
    ridge_season_trend_region_pool: metrics(
      backtestRows,
      "prognoza_model_sezon_trend_regiony",
    ),
    ridge_trend_delta_ensemble: metrics(
      backtestRows,
      "prognoza_model_trend_delta_laczony",
    ),
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
            ridge_season_trend: metrics(examRows, "prognoza_model_sezon_trend"),
            ridge_delta_threshold: metrics(examRows, "prognoza_model_zmiana_progu"),
            ridge_season_trend_region_pool: metrics(
              examRows,
              "prognoza_model_sezon_trend_regiony",
            ),
            ridge_trend_delta_ensemble: metrics(
              examRows,
              "prognoza_model_trend_delta_laczony",
            ),
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
            ridge_season_trend: metrics(roundRows, "prognoza_model_sezon_trend"),
            ridge_delta_threshold: metrics(roundRows, "prognoza_model_zmiana_progu"),
            ridge_season_trend_region_pool: metrics(
              roundRows,
              "prognoza_model_sezon_trend_regiony",
            ),
            ridge_trend_delta_ensemble: metrics(
              roundRows,
              "prognoza_model_trend_delta_laczony",
            ),
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
    selected_forecast: "empiryczna_wazona_prognoza_model_trend_delta_laczony; ensemble regionalny ważony wygładzoną historyczną szansą pełnej puli",
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
    selected_regional_forecast: "prognoza_model_trend_delta_laczony; eksploracyjny ensemble 60% model poziomu, 20% sezon × trend, 20% model zmiany",
    interval_method: "prognoza ensemble trend-delta ± 80. percentyl bezwzględnego błędu tego wariantu w backteście",
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
    "Grupy województw są hipotezą jakościową, a nie pomiarem migracji; wariant grupowy pozostaje diagnostyczny, ponieważ nie obniżył MAE względem modelu bazowego.",
    "Wagi ensemble trend-delta dobrano po obejrzeniu obecnego backtestu; poprawa jest obiecująca, lecz jej niezależnym potwierdzeniem będzie dopiero kolejna zakończona runda.",
  ],
};
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Backtest: ${backtestRows.length} obserwacji.`);
console.log(`Model dwuczęściowy: MAE ${report.two_part_experiment.variants.two_part.mae} wobec produkcji ${report.two_part_experiment.variants.production.mae}. Produkcja bez zmian.`);
console.log(`Skala podaży: bazowe MAE ${report.supply_scale_experiment.variants.baseline.mae}; najlepsze ${report.supply_scale_experiment.best_variant} ${report.supply_scale_experiment.variants[report.supply_scale_experiment.best_variant].mae}. Produkcja bez zmian.`);
console.log(`Eksperyment rankingowy: regionalne MAE ${report.ranking_experiment.regional.ranking.mae}; krajowe MAE ${report.ranking_experiment.national.ranking.mae}. Produkcja bez zmian.`);
console.log(`MAE bez egzaminu: ${report.backtest.ridge_without_exam.mae}.`);
console.log(`MAE sezon × trend: ${report.backtest.ridge_season_trend.mae}.`);
console.log(`MAE modelu zmiany progu: ${report.backtest.ridge_delta_threshold.mae}.`);
console.log(`MAE sezon × trend + grupy województw: ${report.backtest.ridge_season_trend_region_pool.mae}.`);
console.log(`MAE ensemble trend-delta: ${report.backtest.ridge_trend_delta_ensemble.mae}.`);
console.log(`MAE z egzaminem: ${report.backtest.ridge_with_exam.mae}.`);
console.log(`MAE z egzaminem i bieżącym SD: ${report.backtest.ridge_with_exam_and_current_sd.mae}.`);
console.log(`MAE z egzaminem i poprzednim SD: ${report.backtest.ridge_with_exam_and_previous_sd.mae}.`);
console.log(`MAE modelu kotwiczonego egzaminem: ${report.backtest.exam_anchored_model.mae}.`);
console.log(`MAE modelu łączonego: ${report.backtest.blended_model.mae}.`);
console.log(`Prognoza ${FORECAST_ROUND}: ${forecasts.length} kombinacji.`);
console.log(`Najwyższa pewność przed rundą: ${strictHighConfidence.length} obserwacji.`);
console.log(`Krajowy backtest: ${nationalEvaluation.length} tur specjalizacji; prognozy: ${nationalForecasts.length}.`);
console.log(`Model zapełnienia surowy: Brier ${report.fill_model.logistic_raw.brier}.`);
console.log(`Geografia (${geographyBacktestRows.length} obserwacji): MAE baza ${report.geography_experiment.baseline_same_subset.mae}; z geografią ${report.geography_experiment.with_geography.mae}.`);
console.log(`Kalibracja eksperymentalna: Brier ${report.fill_model.logistic_calibrated.brier}; baza ${report.fill_model.smoothed_history_baseline.brier}.`);

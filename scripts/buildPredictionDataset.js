import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const RANKING_DIR = path.join(ROOT, "source_data");
const EXAM_FILE = path.join(ROOT, "prediction", "sources", "cem_lek_ldek_wyniki_2023w_2026j.csv");
const EXAM_SD_FILE = path.join(ROOT, "prediction", "sources", "cem_exam_standard_deviation.csv");
const PLACES_FILE = path.join(ROOT, "prediction", "data", "cmkp_places.csv");
const FACILITY_GEOGRAPHY_FILE = path.join(
  ROOT,
  "prediction",
  "data",
  "cmkp_facility_geography_features.csv",
);
const OUTPUT_DIR = path.join(ROOT, "prediction", "data");
const DATASET_FILE = path.join(OUTPUT_DIR, "recruitment_model_dataset.csv");
const QUALITY_FILE = path.join(OUTPUT_DIR, "data_quality_report.json");

const MIXED_SPECIALTIES = new Set([
  "Chirurgia szczękowo-twarzowa",
  "Epidemiologia",
  "Zdrowie publiczne",
]);

const DENTAL_SPECIALTIES = new Set([
  "Chirurgia stomatologiczna",
  "Ortodoncja",
  "Periodontologia",
  "Protetyka stomatologiczna",
  "Stomatologia dziecięca",
  "Stomatologia zachowawcza z endodoncją",
]);

const OUTPUT_COLUMNS = [
  "rekrutacja",
  "rok",
  "sezon",
  "wojewodztwo",
  "dziedzina_medycyny",
  "sciezka",
  "egzamin",
  "ma_obserwowany_prog",
  "liczba_zakwalifikowanych",
  "prog_min_proc",
  "wynik_q25_proc",
  "wynik_mediana_proc",
  "wynik_srednia_proc",
  "wynik_q75_proc",
  "wynik_max_proc",
  "odchylenie_wynikow_proc",
  "srednia_studiow_mediana",
  "egzamin_srednia_pkt",
  "egzamin_srednia_proc",
  "egzamin_sd_pkt",
  "egzamin_sd_proc",
  "egzamin_sd_dostepne_proc",
  "egzamin_sd_zrodlo",
  "egzamin_poprzednie_sd_proc",
  "egzamin_liczba_przystepujacych",
  "egzamin_odsetek_ponizej_56_proc",
  "egzamin_max_mozliwych_pkt",
  "egzamin_liczba_uniewaznionych_zadan",
  "egzamin_poprzednia_srednia_proc",
  "egzamin_zmiana_sredniej_proc",
  "egzamin_srednia_proc_4_sesje",
  "egzamin_suma_przystapien_4_sesje",
  "oferowane_miejsca_rezydenckie",
  "wskaznik_wypelnienia",
  "status_konkurencyjnosci",
  "pojemnosc_placowek_lacznie",
  "pojemnosc_z_geografia",
  "pokrycie_geografii",
  "liczba_placowek_z_dodatnia_pojemnoscia",
  "liczba_miast",
  "udzial_pojemnosci_duze_miasta",
  "udzial_pojemnosci_miasta_akademickie",
  "udzial_pojemnosci_w_stolicy",
  "srednia_odleglosc_od_stolicy_km",
];

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  values.push(current);
  return values;
}

function readCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const lines = [OUTPUT_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(OUTPUT_COLUMNS.map((column) => csvValue(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function quantile(sortedValues, probability) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function standardDeviation(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function parseRecruitment(rekrutacja) {
  const match = /^([wj])-(\d{4})$/.exec(rekrutacja);
  if (!match) throw new Error(`Nieprawidłowy identyfikator rekrutacji: ${rekrutacja}`);
  return {
    year: Number(match[2]),
    season: match[1] === "w" ? "wiosenna" : "jesienna",
  };
}

function classifySpecialty(specialty) {
  if (MIXED_SPECIALTIES.has(specialty)) return { path: "mieszana_pominieta", exam: null };
  if (DENTAL_SPECIALTIES.has(specialty)) return { path: "stomatologiczna", exam: "LDEK" };
  return { path: "lekarska", exam: "LEK" };
}

function examKey(exam, year, season) {
  return `${exam}::${year}::${season}`;
}

function buildExamIndex(examRows, examSdRows) {
  const sdByKey = new Map(
    examSdRows.map((row) => [
      examKey(row.egzamin, Number(row.rok), row.sesja),
      numberOrNull(row.odchylenie_standardowe_pkt),
    ]),
  );
  const normalized = examRows.map((row) => {
    const meanPoints = numberOrNull(row.srednia_pkt);
    const maxPoints = numberOrNull(row.max_mozliwych_pkt);
    const participants = numberOrNull(row.liczba_przystepujacych);
    const below = numberOrNull(row.liczba_ponizej_56_proc);
    return {
      ...row,
      year: Number(row.rok),
      meanPoints,
      maxPoints,
      participants,
      below,
      standardDeviationPoints: sdByKey.get(examKey(row.egzamin, Number(row.rok), row.sesja)) ?? null,
      meanPercent: meanPoints !== null && maxPoints ? (meanPoints / maxPoints) * 100 : null,
      belowPercent: below !== null && participants ? (below / participants) * 100 : null,
      standardDeviationPercent:
        sdByKey.get(examKey(row.egzamin, Number(row.rok), row.sesja)) !== undefined && maxPoints
          ? (sdByKey.get(examKey(row.egzamin, Number(row.rok), row.sesja)) / maxPoints) * 100
          : null,
    };
  });

  normalized.sort((a, b) => {
    const seasonOrder = { wiosenna: 0, jesienna: 1 };
    return a.year - b.year || seasonOrder[a.sesja] - seasonOrder[b.sesja];
  });

  return {
    byKey: new Map(normalized.map((row) => [examKey(row.egzamin, row.year, row.sesja), row])),
    byExam: new Map(["LEK", "LDEK"].map((exam) => [exam, normalized.filter((row) => row.egzamin === exam)])),
  };
}

function getExamFeatures(index, exam, year, season) {
  const current = index.byKey.get(examKey(exam, year, season));
  if (!current) return null;
  const history = index.byExam.get(exam) ?? [];
  const currentIndex = history.indexOf(current);
  const previous = currentIndex > 0 ? history[currentIndex - 1] : null;
  const trailing = history.slice(Math.max(0, currentIndex - 3), currentIndex + 1);
  const trailingMeans = trailing.map((row) => row.meanPercent).filter(Number.isFinite);
  const trailingParticipants = trailing.map((row) => row.participants).filter(Number.isFinite);

  return {
    current,
    previous,
    trailingMean:
      trailingMeans.length > 0
        ? trailingMeans.reduce((sum, value) => sum + value, 0) / trailingMeans.length
        : null,
    trailingParticipants: trailingParticipants.reduce((sum, value) => sum + value, 0),
  };
}

const rankingFiles = fs
  .readdirSync(RANKING_DIR)
  .filter((fileName) => /^[wj]-\d{4}_parsed\.csv$/.test(fileName))
  .sort();

if (rankingFiles.length === 0) throw new Error("Nie znaleziono plików rankingowych w source_data.");
if (!fs.existsSync(EXAM_FILE)) throw new Error(`Nie znaleziono pliku egzaminacyjnego: ${EXAM_FILE}`);
if (!fs.existsSync(EXAM_SD_FILE)) throw new Error(`Nie znaleziono statystyk odchylenia CEM: ${EXAM_SD_FILE}`);
if (!fs.existsSync(PLACES_FILE)) {
  throw new Error(
    "Nie znaleziono prediction/data/cmkp_places.csv. Najpierw uruchom parser wykazów miejsc.",
  );
}

const allRankingRows = rankingFiles.flatMap((fileName) => readCsv(path.join(RANKING_DIR, fileName)));
const completedRecruitments = new Set(allRankingRows.map((row) => row.rekrutacja));
const examRows = readCsv(EXAM_FILE);
const examSdRows = readCsv(EXAM_SD_FILE);
const placesRows = readCsv(PLACES_FILE);
const facilityGeographyRows = fs.existsSync(FACILITY_GEOGRAPHY_FILE)
  ? readCsv(FACILITY_GEOGRAPHY_FILE)
  : [];
const examIndex = buildExamIndex(examRows, examSdRows);
const placesIndex = new Map(
  placesRows.map((row) => [
    [row.rekrutacja, row.wojewodztwo, row.dziedzina_medycyny].join("::"),
    row,
  ]),
);
const facilityGeographyIndex = new Map(
  facilityGeographyRows.map((row) => [
    [row.rekrutacja, row.wojewodztwo, row.dziedzina_medycyny].join("::"),
    row,
  ]),
);
const geographyValues = (groupKey) => {
  const source = facilityGeographyIndex.get(groupKey);
  return {
    pojemnosc_placowek_lacznie: numberOrNull(source?.pojemnosc_placowek_lacznie),
    pojemnosc_z_geografia: numberOrNull(source?.pojemnosc_z_geografia),
    pokrycie_geografii: numberOrNull(source?.pokrycie_geografii),
    liczba_placowek_z_dodatnia_pojemnoscia: numberOrNull(
      source?.liczba_placowek_z_dodatnia_pojemnoscia,
    ),
    liczba_miast: numberOrNull(source?.liczba_miast),
    udzial_pojemnosci_duze_miasta: numberOrNull(source?.udzial_pojemnosci_duze_miasta),
    udzial_pojemnosci_miasta_akademickie: numberOrNull(
      source?.udzial_pojemnosci_miasta_akademickie,
    ),
    udzial_pojemnosci_w_stolicy: numberOrNull(source?.udzial_pojemnosci_w_stolicy),
    srednia_odleglosc_od_stolicy_km: numberOrNull(source?.srednia_odleglosc_od_stolicy_km),
  };
};
const groups = new Map();
const excludedMixedCounts = new Map();

for (const row of allRankingRows) {
  if (row.tryb_szkolenia !== "Rezydencki" || row.czy_miejsca_doktoranckie === "TAK") continue;
  const classification = classifySpecialty(row.dziedzina_medycyny);
  if (classification.path === "mieszana_pominieta") {
    excludedMixedCounts.set(
      row.dziedzina_medycyny,
      (excludedMixedCounts.get(row.dziedzina_medycyny) ?? 0) + 1,
    );
    continue;
  }

  const key = [row.rekrutacja, row.wojewodztwo, row.dziedzina_medycyny].join("::");
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const dataset = [];
let missingExamFeatureGroups = 0;

for (const rows of groups.values()) {
  const first = rows[0];
  const { year, season } = parseRecruitment(first.rekrutacja);
  const classification = classifySpecialty(first.dziedzina_medycyny);
  const examFeatures = getExamFeatures(examIndex, classification.exam, year, season);
  if (!examFeatures) missingExamFeatureGroups += 1;

  const scores = rows
    .map((row) => numberOrNull(row.punktacja_proc))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const studyAverages = rows
    .map((row) => numberOrNull(row.srednia_arytmetyczna))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const scoreMean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const currentExam = examFeatures?.current;
  const previousExam = examFeatures?.previous;
  const groupKey = [first.rekrutacja, first.wojewodztwo, first.dziedzina_medycyny].join("::");
  const places = placesIndex.get(groupKey);
  const regularPlaces = numberOrNull(places?.miejsca_rezydenckie_zwykle);
  const fillRate = regularPlaces > 0 ? rows.length / regularPlaces : null;
  let competitionStatus = "brak_danych_o_miejscach";
  if (regularPlaces === 0) competitionStatus = "niespojne_brak_miejsc";
  if (regularPlaces > 0 && rows.length < regularPlaces) competitionStatus = "niepelna_pula";
  if (regularPlaces > 0 && rows.length === regularPlaces) {
    competitionStatus = "pelna_pula_proxy_konkurencji";
  }
  if (regularPlaces > 0 && rows.length > regularPlaces) {
    competitionStatus = "niespojne_wiecej_przyjetych_niz_miejsc";
  }

  dataset.push({
    rekrutacja: first.rekrutacja,
    rok: year,
    sezon: season,
    wojewodztwo: first.wojewodztwo,
    dziedzina_medycyny: first.dziedzina_medycyny,
    sciezka: classification.path,
    egzamin: classification.exam,
    ma_obserwowany_prog: "TAK",
    liczba_zakwalifikowanych: rows.length,
    prog_min_proc: round(scores[0]),
    wynik_q25_proc: round(quantile(scores, 0.25)),
    wynik_mediana_proc: round(quantile(scores, 0.5)),
    wynik_srednia_proc: round(scoreMean),
    wynik_q75_proc: round(quantile(scores, 0.75)),
    wynik_max_proc: round(scores.at(-1)),
    odchylenie_wynikow_proc: round(standardDeviation(scores)),
    srednia_studiow_mediana: round(quantile(studyAverages, 0.5)),
    egzamin_srednia_pkt: currentExam?.meanPoints ?? null,
    egzamin_srednia_proc: round(currentExam?.meanPercent),
    egzamin_sd_pkt: currentExam?.standardDeviationPoints ?? null,
    egzamin_sd_proc: round(currentExam?.standardDeviationPercent),
    egzamin_sd_dostepne_proc: round(
      currentExam?.standardDeviationPercent ?? previousExam?.standardDeviationPercent,
    ),
    egzamin_sd_zrodlo: Number.isFinite(currentExam?.standardDeviationPercent)
      ? "biezaca_sesja"
      : Number.isFinite(previousExam?.standardDeviationPercent)
        ? "poprzednia_sesja"
        : "brak",
    egzamin_poprzednie_sd_proc: round(previousExam?.standardDeviationPercent),
    egzamin_liczba_przystepujacych: currentExam?.participants ?? null,
    egzamin_odsetek_ponizej_56_proc: round(currentExam?.belowPercent),
    egzamin_max_mozliwych_pkt: currentExam?.maxPoints ?? null,
    egzamin_liczba_uniewaznionych_zadan:
      numberOrNull(currentExam?.liczba_uniewaznionych_zadan) ?? null,
    egzamin_poprzednia_srednia_proc: round(previousExam?.meanPercent),
    egzamin_zmiana_sredniej_proc:
      Number.isFinite(currentExam?.meanPercent) && Number.isFinite(previousExam?.meanPercent)
        ? round(currentExam.meanPercent - previousExam.meanPercent)
        : null,
    egzamin_srednia_proc_4_sesje: round(examFeatures?.trailingMean),
    egzamin_suma_przystapien_4_sesje: examFeatures?.trailingParticipants ?? null,
    oferowane_miejsca_rezydenckie: regularPlaces,
    wskaznik_wypelnienia: round(fillRate),
    status_konkurencyjnosci: competitionStatus,
    ...geographyValues(groupKey),
  });
}

for (const places of placesRows) {
  const regularPlaces = numberOrNull(places.miejsca_rezydenckie_zwykle);
  if (!(regularPlaces > 0)) continue;
  const classification = classifySpecialty(places.dziedzina_medycyny);
  if (classification.path === "mieszana_pominieta") continue;
  const groupKey = [places.rekrutacja, places.wojewodztwo, places.dziedzina_medycyny].join("::");
  if (groups.has(groupKey)) continue;

  const { year, season } = parseRecruitment(places.rekrutacja);
  const examFeatures = getExamFeatures(examIndex, classification.exam, year, season);
  const currentExam = examFeatures?.current;
  const previousExam = examFeatures?.previous;
  const isCompleted = completedRecruitments.has(places.rekrutacja);
  dataset.push({
    rekrutacja: places.rekrutacja,
    rok: year,
    sezon: season,
    wojewodztwo: places.wojewodztwo,
    dziedzina_medycyny: places.dziedzina_medycyny,
    sciezka: classification.path,
    egzamin: classification.exam,
    ma_obserwowany_prog: "NIE",
    liczba_zakwalifikowanych: isCompleted ? 0 : null,
    prog_min_proc: null,
    wynik_q25_proc: null,
    wynik_mediana_proc: null,
    wynik_srednia_proc: null,
    wynik_q75_proc: null,
    wynik_max_proc: null,
    odchylenie_wynikow_proc: null,
    srednia_studiow_mediana: null,
    egzamin_srednia_pkt: currentExam?.meanPoints ?? null,
    egzamin_srednia_proc: round(currentExam?.meanPercent),
    egzamin_sd_pkt: currentExam?.standardDeviationPoints ?? null,
    egzamin_sd_proc: round(currentExam?.standardDeviationPercent),
    egzamin_sd_dostepne_proc: round(
      currentExam?.standardDeviationPercent ?? previousExam?.standardDeviationPercent,
    ),
    egzamin_sd_zrodlo: Number.isFinite(currentExam?.standardDeviationPercent)
      ? "biezaca_sesja"
      : Number.isFinite(previousExam?.standardDeviationPercent)
        ? "poprzednia_sesja"
        : "brak",
    egzamin_poprzednie_sd_proc: round(previousExam?.standardDeviationPercent),
    egzamin_liczba_przystepujacych: currentExam?.participants ?? null,
    egzamin_odsetek_ponizej_56_proc: round(currentExam?.belowPercent),
    egzamin_max_mozliwych_pkt: currentExam?.maxPoints ?? null,
    egzamin_liczba_uniewaznionych_zadan:
      numberOrNull(currentExam?.liczba_uniewaznionych_zadan) ?? null,
    egzamin_poprzednia_srednia_proc: round(previousExam?.meanPercent),
    egzamin_zmiana_sredniej_proc:
      Number.isFinite(currentExam?.meanPercent) && Number.isFinite(previousExam?.meanPercent)
        ? round(currentExam.meanPercent - previousExam.meanPercent)
        : null,
    egzamin_srednia_proc_4_sesje: round(examFeatures?.trailingMean),
    egzamin_suma_przystapien_4_sesje: examFeatures?.trailingParticipants ?? null,
    oferowane_miejsca_rezydenckie: regularPlaces,
    wskaznik_wypelnienia: isCompleted ? 0 : null,
    status_konkurencyjnosci: isCompleted
      ? "niepelna_pula_bez_zakwalifikowanych"
      : "wynik_niedostepny",
    ...geographyValues(groupKey),
  });
}

dataset.sort(
  (a, b) =>
    a.rok - b.rok ||
    (a.sezon === "wiosenna" ? 0 : 1) - (b.sezon === "wiosenna" ? 0 : 1) ||
    a.dziedzina_medycyny.localeCompare(b.dziedzina_medycyny, "pl") ||
    a.wojewodztwo.localeCompare(b.wojewodztwo, "pl"),
);

const groupSizes = dataset
  .filter((row) => row.ma_obserwowany_prog === "TAK")
  .map((row) => row.liczba_zakwalifikowanych)
  .sort((a, b) => a - b);
const qualityReport = {
  generated_at: new Date().toISOString(),
  sources: {
    ranking_files: rankingFiles,
    exam_file: path.relative(ROOT, EXAM_FILE).replaceAll("\\", "/"),
    exam_sd_file: path.relative(ROOT, EXAM_SD_FILE).replaceAll("\\", "/"),
    places_file: path.relative(ROOT, PLACES_FILE).replaceAll("\\", "/"),
    facility_geography_file: fs.existsSync(FACILITY_GEOGRAPHY_FILE)
      ? path.relative(ROOT, FACILITY_GEOGRAPHY_FILE).replaceAll("\\", "/")
      : null,
  },
  filters: {
    tryb_szkolenia: "Rezydencki",
    miejsca_doktoranckie: "wykluczone",
    specjalizacje_mieszane: [...MIXED_SPECIALTIES],
  },
  counts: {
    source_ranking_rows: allRankingRows.length,
    model_groups: dataset.length,
    groups_with_observed_threshold: dataset.filter((row) => row.ma_obserwowany_prog === "TAK").length,
    offered_groups_without_accepted_candidate: dataset.filter(
      (row) => row.status_konkurencyjnosci === "niepelna_pula_bez_zakwalifikowanych",
    ).length,
    future_groups_ready_for_prediction: dataset.filter(
      (row) => row.status_konkurencyjnosci === "wynik_niedostepny",
    ).length,
    medical_groups: dataset.filter((row) => row.sciezka === "lekarska").length,
    dental_groups: dataset.filter((row) => row.sciezka === "stomatologiczna").length,
    single_person_groups: dataset.filter((row) => row.liczba_zakwalifikowanych === 1).length,
    groups_with_at_least_5_people: dataset.filter((row) => row.liczba_zakwalifikowanych >= 5).length,
    groups_missing_exam_features: missingExamFeatureGroups,
    groups_with_current_exam_sd: dataset.filter((row) => row.egzamin_sd_proc !== null).length,
    groups_with_previous_exam_sd: dataset.filter((row) => row.egzamin_poprzednie_sd_proc !== null).length,
    groups_with_current_sd_used: dataset.filter((row) => row.egzamin_sd_zrodlo === "biezaca_sesja").length,
    groups_with_previous_sd_fallback: dataset.filter((row) => row.egzamin_sd_zrodlo === "poprzednia_sesja").length,
    groups_with_facility_geography: dataset.filter(
      (row) => Number.isFinite(row.srednia_odleglosc_od_stolicy_km),
    ).length,
    competition_statuses: Object.fromEntries(
      [...new Set(dataset.map((row) => row.status_konkurencyjnosci))]
        .sort()
        .map((status) => [status, dataset.filter((row) => row.status_konkurencyjnosci === status).length]),
    ),
    excluded_mixed_rows: Object.fromEntries([...excludedMixedCounts].sort()),
  },
  accepted_group_size: {
    minimum: groupSizes[0],
    median: quantile(groupSizes, 0.5),
    maximum: groupSizes.at(-1),
  },
  known_limitations: [
    "Pełne obsadzenie puli jest wskaźnikiem zastępczym konkurencji, ponieważ listy niezakwalifikowanych nie zawierają wariantów ani wyników.",
    "Suma przystąpień do egzaminów nie oznacza liczby unikalnych kandydatów.",
    "Archiwum statystyk CEM zawiera odchylenie standardowe do wiosny 2026; dla jesieni 2026 dostępne jest tylko odchylenie poprzedniej sesji.",
    "Nie są dostępne górne percentyle wyników kandydatów ani liczba unikalnych osób kandydujących.",
    "Najniższy wynik zakwalifikowanego nie jest progiem konkurencyjnym przy niewypełnionej puli miejsc.",
  ],
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeCsv(DATASET_FILE, dataset);
fs.writeFileSync(QUALITY_FILE, `${JSON.stringify(qualityReport, null, 2)}\n`, "utf8");

console.log(`Zapisano ${dataset.length} grup do ${path.relative(ROOT, DATASET_FILE)}.`);
console.log(`Raport jakości: ${path.relative(ROOT, QUALITY_FILE)}.`);

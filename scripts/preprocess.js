import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.join(__dirname, "../source_data");
const OUTPUT_DIR = path.join(__dirname, "../public/data");
const METADATA_FILE = path.join(__dirname, "../src/data/reportMetadata.ts");
const PLACES_FILE = path.join(SOURCE_DIR, "cmkp_places.csv");

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Columns configuration
const columnMap = {
  rekrutacja: "rekrutacja",
  "kolejność_plików": "kolejnosc_plikow",
  kolejnosc_plikow: "kolejnosc_plikow",
  publication_date: "publication_date",
  print_datetime: "print_datetime",
  page: "page",
  page_total: "page_total",
  wojewodztwo: "wojewodztwo",
  lp: "lp",
  dziedzina_medycyny: "dziedzina_medycyny",
  numer_wniosku: "numer_wniosku",
  tryb_szkolenia: "tryb_szkolenia",
  punktacja_proc: "punktacja_proc",
  srednia_arytmetyczna: "srednia_arytmetyczna",
  data_zlozenia_wniosku: "data_zlozenia_wniosku",
  "ilość_zakwalifikowanych_w_trybie": "ilosc_zakwalifikowanych_w_trybie",
  ilosc_zakwalifikowanych_w_trybie: "ilosc_zakwalifikowanych_w_trybie",
  czy_miejsca_doktoranckie: "czy_miejsca_doktoranckie",
  doktoranckie_podmiot: "doktoranckie_podmiot",
  doktoranckie_jednostka: "doktoranckie_jednostka",
};

const numericColumns = new Set([
  "kolejnosc_plikow",
  "lp",
  "punktacja_proc",
  "srednia_arytmetyczna",
  "ilosc_zakwalifikowanych_w_trybie",
]);

const columnsToKeep = [
  "rekrutacja",
  "kolejnosc_plikow",
  "wojewodztwo",
  "lp",
  "dziedzina_medycyny",
  "numer_wniosku",
  "tryb_szkolenia",
  "punktacja_proc",
  "srednia_arytmetyczna",
  "data_zlozenia_wniosku",
  "ilosc_zakwalifikowanych_w_trybie",
  "czy_miejsca_doktoranckie",
  "doktoranckie_podmiot",
  "doktoranckie_jednostka",
];

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  const headers = parseCsvLine(lines[0]).map((h) => columnMap[h] ?? h);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      if (columnsToKeep.includes(header)) {
        const val = values[index] ?? "";
        row[header] = numericColumns.has(header) ? Number(val) : val;
      }
    });
    rows.push(row);
  }
  return rows;
}

function parseRawCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function numericOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function slugify(text) {
  const polishChars = {
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
    'Ą': 'a', 'Ć': 'c', 'Ę': 'e', 'Ł': 'l', 'Ń': 'n', 'Ó': 'o', 'Ś': 's', 'Ź': 'z', 'Ż': 'z'
  };
  return text
    .split('')
    .map(c => polishChars[c] || c)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

console.log("Rozpoczynanie przetwarzania plików CSV...");

// Read all recruitment result CSV files (source_data/ also holds cmkp_places.csv)
const files = fs.readdirSync(SOURCE_DIR).filter((f) => /^[wj]-\d{4}_parsed\.csv$/.test(f));
let allRows = [];
const recruitmentOrder = {};

for (const file of files) {
  const filePath = path.join(SOURCE_DIR, file);
  console.log(`Czytanie pliku: ${file}`);
  const csvText = fs.readFileSync(filePath, "utf-8");
  const rows = parseCsv(csvText);
  allRows = allRows.concat(rows);
}

console.log(`Przetworzono łącznie wierszy: ${allRows.length}`);

// Group rows by specialization
const grouped = {};
for (const row of allRows) {
  const specialty = row.dziedzina_medycyny;
  if (!specialty) continue;
  
  if (!grouped[specialty]) {
    grouped[specialty] = [];
  }
  grouped[specialty].push(row);

  // Map recruitment name to its sequence index for chronology
  if (row.rekrutacja && row.kolejnosc_plikow !== undefined) {
    if (recruitmentOrder[row.rekrutacja] === undefined || row.kolejnosc_plikow > recruitmentOrder[row.rekrutacja]) {
      recruitmentOrder[row.rekrutacja] = row.kolejnosc_plikow;
    }
  }
}

// Generate unique, sorted lists
const dziedziny = Object.keys(grouped).sort((a, b) => a.localeCompare(b, "pl"));

const rekrutacje = [...new Set(allRows.map((r) => r.rekrutacja).filter(Boolean))];
rekrutacje.sort((a, b) => (recruitmentOrder[b] || 0) - (recruitmentOrder[a] || 0));
const completedRecruitments = new Set(rekrutacje);

const placesRows = fs.existsSync(PLACES_FILE)
  ? parseRawCsv(fs.readFileSync(PLACES_FILE, "utf-8"))
  : [];
if (placesRows.length === 0) {
  console.warn("Nie znaleziono danych CMKP o liczbie miejsc; status progów będzie nieustalony.");
}

const candidatePools = new Map();
for (const row of allRows) {
  if (row.czy_miejsca_doktoranckie === "TAK") continue;
  const key = [row.rekrutacja, row.wojewodztwo, row.dziedzina_medycyny, row.tryb_szkolenia].join("::");
  if (!candidatePools.has(key)) candidatePools.set(key, []);
  candidatePools.get(key).push(row);
}

const capacityByPool = new Map();
for (const row of placesRows) {
  if (!completedRecruitments.has(row.rekrutacja)) continue;
  const residentKey = [row.rekrutacja, row.wojewodztwo, row.dziedzina_medycyny, "Rezydencki"].join("::");
  const nonResidentKey = [row.rekrutacja, row.wojewodztwo, row.dziedzina_medycyny, "Pozarezydencki"].join("::");
  capacityByPool.set(residentKey, numericOrNull(row.miejsca_rezydenckie_zwykle));
  capacityByPool.set(nonResidentKey, numericOrNull(row.miejsca_pozarezydenckie));
}

// Offered places for every published CMKP list, including announced rounds without results yet.
function recruitmentSortKey(rekrutacja) {
  const match = /^([wj])-(\d{4})$/.exec(rekrutacja);
  if (!match) return 0;
  return Number(match[2]) * 2 + (match[1] === "j" ? 1 : 0);
}

const latestCompletedKey = Math.max(0, ...rekrutacje.map(recruitmentSortKey));
const zapowiedzianeRekrutacje = [...new Set(placesRows.map((row) => row.rekrutacja))]
  .filter((rekrutacja) => !completedRecruitments.has(rekrutacja) && recruitmentSortKey(rekrutacja) > latestCompletedKey)
  .sort((a, b) => recruitmentSortKey(b) - recruitmentSortKey(a));

const placesBySpecialty = {};
for (const row of placesRows) {
  const specialty = row.dziedzina_medycyny;
  if (!placesBySpecialty[specialty]) placesBySpecialty[specialty] = [];
  for (const [trybSzkolenia, column] of [
    ["Rezydencki", "miejsca_rezydenckie_zwykle"],
    ["Pozarezydencki", "miejsca_pozarezydenckie"],
  ]) {
    const capacity = numericOrNull(row[column]);
    if (capacity === null) continue;
    placesBySpecialty[specialty].push({
      rekrutacja: row.rekrutacja,
      wojewodztwo: row.wojewodztwo,
      dziedzina_medycyny: specialty,
      tryb_szkolenia: trybSzkolenia,
      liczba_miejsc: capacity,
    });
  }
}

const poolKeys = new Set(candidatePools.keys());
for (const [key, capacity] of capacityByPool) {
  if (capacity > 0) poolKeys.add(key);
}

const poolsBySpecialty = {};
for (const key of poolKeys) {
  const [rekrutacja, wojewodztwo, dziedzinaMedycyny, trybSzkolenia] = key.split("::");
  const candidates = candidatePools.get(key) ?? [];
  const capacity = capacityByPool.get(key) ?? null;
  const accepted = candidates.length;
  const scores = candidates.map((row) => Number(row.punktacja_proc)).filter(Number.isFinite);
  let status = "missing_capacity";
  if (capacity !== null && accepted === 0 && capacity > 0) status = "no_accepted";
  else if (capacity !== null && accepted < capacity) status = "underfilled";
  else if (capacity !== null && capacity > 0 && accepted === capacity) status = "full";
  else if (capacity !== null && accepted >= capacity) status = "inconsistent";

  const pool = {
    rekrutacja,
    wojewodztwo,
    dziedzina_medycyny: dziedzinaMedycyny,
    tryb_szkolenia: trybSzkolenia,
    liczba_zakwalifikowanych: accepted,
    liczba_miejsc: capacity,
    najnizszy_wynik_proc: scores.length > 0 ? Math.min(...scores) : null,
    status_konkurencyjnosci: status,
  };
  if (!poolsBySpecialty[dziedzinaMedycyny]) poolsBySpecialty[dziedzinaMedycyny] = [];
  poolsBySpecialty[dziedzinaMedycyny].push(pool);
}

console.log(`Znaleziono specjalizacji: ${dziedziny.length}`);
console.log("Kolejność rekrutacji (od najnowszej):", rekrutacje);
console.log("Rekrutacje zapowiedziane (bez wyników):", zapowiedzianeRekrutacje);

// Write individual JSON files
const specialtyFilesMap = {};
const specialtyPoolFilesMap = {};
const specialtyPlacesFilesMap = {};
for (const specialty of dziedziny) {
  const slug = slugify(specialty);
  const fileName = `specialty_${slug}.json`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  
  fs.writeFileSync(outputPath, JSON.stringify(grouped[specialty], null, 2), "utf-8");
  specialtyFilesMap[specialty] = fileName;

  const poolFileName = `pools_${slug}.json`;
  fs.writeFileSync(
    path.join(OUTPUT_DIR, poolFileName),
    JSON.stringify(poolsBySpecialty[specialty] ?? [], null, 2),
    "utf-8",
  );
  specialtyPoolFilesMap[specialty] = poolFileName;

  const placesFileName = `places_${slug}.json`;
  fs.writeFileSync(
    path.join(OUTPUT_DIR, placesFileName),
    JSON.stringify(placesBySpecialty[specialty] ?? [], null, 2),
    "utf-8",
  );
  specialtyPlacesFilesMap[specialty] = placesFileName;
}

console.log("Zapisano pliki JSON specjalizacji.");

// Rozkład wyborów specjalizacji według wyniku (cała Polska, bez miejsc doktoranckich):
// dla każdej rekrutacji, trybu i specjalizacji liczba zakwalifikowanych w kolejnych przedziałach punktacji.
const SCORE_BIN_WIDTH = 1;
const SCORE_BIN_COUNT = 100 / SCORE_BIN_WIDTH;
const choiceBuckets = new Map();
for (const row of allRows) {
  if (row.czy_miejsca_doktoranckie === "TAK" || !Number.isFinite(row.punktacja_proc)) continue;
  const key = [row.rekrutacja, row.tryb_szkolenia, row.dziedzina_medycyny].join("::");
  if (!choiceBuckets.has(key)) choiceBuckets.set(key, new Array(SCORE_BIN_COUNT).fill(0));
  const bin = Math.min(SCORE_BIN_COUNT - 1, Math.max(0, Math.floor(row.punktacja_proc / SCORE_BIN_WIDTH)));
  choiceBuckets.get(key)[bin] += 1;
}
// Liczba miejsc w skali kraju (suma po województwach) dla rozstrzygniętych rekrutacji: pozwala pokazać zapełnianie miejsc.
const placeTotals = new Map();
for (const row of placesRows) {
  if (!completedRecruitments.has(row.rekrutacja)) continue;
  for (const [tryb, column] of [
    ["Rezydencki", "miejsca_rezydenckie_zwykle"],
    ["Pozarezydencki", "miejsca_pozarezydenckie"],
  ]) {
    const capacity = numericOrNull(row[column]);
    if (capacity === null || capacity <= 0) continue;
    const key = [row.rekrutacja, tryb, row.dziedzina_medycyny].join("::");
    placeTotals.set(key, (placeTotals.get(key) ?? 0) + capacity);
  }
}
const scoreChoices = {
  binWidth: SCORE_BIN_WIDTH,
  places: [...placeTotals].map(([key, miejsca]) => {
    const [rekrutacja, tryb, specjalizacja] = key.split("::");
    return { rekrutacja, tryb, specjalizacja, miejsca };
  }),
  rows: [...choiceBuckets].map(([key, bins]) => {
    const [rekrutacja, tryb, specjalizacja] = key.split("::");
    return { rekrutacja, tryb, specjalizacja, bins };
  }),
};
fs.writeFileSync(path.join(OUTPUT_DIR, "score_choices.json"), JSON.stringify(scoreChoices), "utf-8");
console.log(`Zapisano rozkład wyborów specjalizacji (${scoreChoices.rows.length} wierszy).`);

// Prognoza progów na zapowiedzianą rundę (source_data/forecast_<runda>.csv, patrz data_pipeline/forecast).
const forecastFiles = fs.readdirSync(SOURCE_DIR).filter((f) => /^forecast_[wj]-\d{4}\.csv$/.test(f)).sort();
const forecastRows = forecastFiles.flatMap((file) =>
  parseRawCsv(fs.readFileSync(path.join(SOURCE_DIR, file), "utf-8")).map((row) => ({
    rekrutacja: row.rekrutacja,
    wojewodztwo: row.wojewodztwo,
    dziedzina_medycyny: row.dziedzina_medycyny,
    tryb_szkolenia: "Rezydencki",
    liczba_miejsc: numericOrNull(row.liczba_miejsc),
    poziom_pewnosci: row.poziom_pewnosci,
    prawdopodobienstwo_pelnej_puli: numericOrNull(row.prawdopodobienstwo_pelnej_puli),
    prognoza_proc: numericOrNull(row.prognoza_modelowa),
    dolna_proc: numericOrNull(row.dolna_granica_80_proc),
    gorna_proc: numericOrNull(row.gorna_granica_80_proc),
  })),
);
fs.writeFileSync(path.join(OUTPUT_DIR, "forecast.json"), JSON.stringify(forecastRows), "utf-8");
console.log(`Zapisano prognozy progów (${forecastRows.length} wierszy).`);

// Write metadata file
const metadataContent = `// Ten plik jest generowany automatycznie przez skrypt preprocess.js. Nie edytuj go ręcznie.
import type { TrybSzkolenia, PrzedstawWynikJako } from "../types";

export const dziedziny: string[] = ${JSON.stringify(dziedziny, null, 2)};

export const rekrutacje: string[] = ${JSON.stringify(rekrutacje, null, 2)};

// Rekrutacje z opublikowaną liczbą miejsc, ale bez wyników (od najnowszej).
export const zapowiedzianeRekrutacje: string[] = ${JSON.stringify(zapowiedzianeRekrutacje, null, 2)};

export const tryby: TrybSzkolenia[] = ["Rezydencki", "Pozarezydencki"];

export const przedstawWynikJako: PrzedstawWynikJako[] = [
  "% punktów rekrutacyjnych (domyślne)",
  "surowa ilość punktów rekrutacyjnych (poglądowo)",
];

export const specialtyFilesMap: Record<string, string> = ${JSON.stringify(specialtyFilesMap, null, 2)};

export const specialtyPoolFilesMap: Record<string, string> = ${JSON.stringify(specialtyPoolFilesMap, null, 2)};

export const specialtyPlacesFilesMap: Record<string, string> = ${JSON.stringify(specialtyPlacesFilesMap, null, 2)};
`;

fs.writeFileSync(METADATA_FILE, metadataContent, "utf-8");
console.log(`Zapisano metadane do: ${METADATA_FILE}`);
console.log("Przetwarzanie zakończone sukcesem!");

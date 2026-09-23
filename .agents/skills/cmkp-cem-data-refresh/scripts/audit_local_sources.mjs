import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, "..", "..", "..", "..");
const root = path.resolve(process.argv[2] ?? defaultRoot);
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function readText(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    fail(`Brakuje pliku: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function parseCsv(text, label) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) fail(`${label}: niezamknięte pole w cudzysłowie.`);
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const nonempty = rows.filter((values) => values.some((value) => value !== ""));
  const headers = nonempty[0] ?? [];
  const records = [];
  for (let index = 1; index < nonempty.length; index += 1) {
    const values = nonempty[index];
    if (values.length !== headers.length) {
      fail(`${label}, wiersz ${index + 1}: ${values.length} pól zamiast ${headers.length}.`);
      continue;
    }
    records.push(Object.fromEntries(headers.map((header, column) => [header, values[column]])));
  }
  return { headers, records };
}

function number(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function periodIndex(year, season) {
  return Number(year) * 2 + (season === "jesienna" ? 1 : 0);
}

function periodLabel(record) {
  return `${record.rok}-${record.sesja}`;
}

const examPath = "prediction/sources/cem_lek_ldek_wyniki_2023w_2026j.csv";
const sdPath = "prediction/sources/cem_exam_standard_deviation.csv";
const manifestPath = "prediction/sources/cmkp_places_manifest.json";
const placesPath = "prediction/data/cmkp_places.csv";

const exam = parseCsv(readText(examPath), examPath);
const requiredExamHeaders = [
  "egzamin", "rok", "sesja", "data_publikacji", "liczba_przystepujacych",
  "srednia_pkt", "min_pkt", "max_pkt", "liczba_ponizej_56_proc",
  "max_mozliwych_pkt", "liczba_uniewaznionych_zadan", "zrodlo",
];
for (const header of requiredExamHeaders) {
  if (!exam.headers.includes(header)) fail(`${examPath}: brakuje kolumny ${header}.`);
}

const examKeys = new Set();
const examsByPeriod = new Map();
for (let index = 0; index < exam.records.length; index += 1) {
  const record = exam.records[index];
  const row = index + 2;
  const key = `${record.egzamin}|${record.rok}|${record.sesja}`;
  if (!new Set(["LEK", "LDEK"]).has(record.egzamin)) fail(`${examPath}, wiersz ${row}: nieznany egzamin.`);
  if (!new Set(["wiosenna", "jesienna"]).has(record.sesja)) fail(`${examPath}, wiersz ${row}: nieznana sesja.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.data_publikacji)) fail(`${examPath}, wiersz ${row}: błędna data.`);
  if (!/^https:\/\/(www\.)?cem\.edu\.pl\//.test(record.zrodlo)) fail(`${examPath}, wiersz ${row}: źródło nie jest oficjalnym adresem CEM.`);
  if (examKeys.has(key)) fail(`${examPath}: zduplikowany rekord ${key}.`);
  examKeys.add(key);

  const numericFields = ["rok", "liczba_przystepujacych", "srednia_pkt", "min_pkt", "max_pkt", "liczba_ponizej_56_proc", "max_mozliwych_pkt", "liczba_uniewaznionych_zadan"];
  for (const fieldName of numericFields) {
    if (record[fieldName] !== "" && number(record[fieldName]) === null) fail(`${examPath}, wiersz ${row}: ${fieldName} nie jest liczbą.`);
  }
  const participants = number(record.liczba_przystepujacych);
  const below = number(record.liczba_ponizej_56_proc);
  const minimum = number(record.min_pkt);
  const mean = number(record.srednia_pkt);
  const maximum = number(record.max_pkt);
  const possible = number(record.max_mozliwych_pkt);
  if (participants !== null && participants <= 0) fail(`${examPath}, wiersz ${row}: liczba przystępujących musi być dodatnia.`);
  if (below !== null && participants !== null && (below < 0 || below > participants)) fail(`${examPath}, wiersz ${row}: liczba poniżej progu jest poza zakresem.`);
  if ([minimum, mean, maximum].every((value) => value !== null) && !(minimum <= mean && mean <= maximum)) fail(`${examPath}, wiersz ${row}: średnia nie leży między minimum i maksimum.`);
  if (maximum !== null && possible !== null && maximum > possible) fail(`${examPath}, wiersz ${row}: maksimum przekracza możliwą pulę punktów.`);

  const period = `${record.rok}|${record.sesja}`;
  const set = examsByPeriod.get(period) ?? new Set();
  set.add(record.egzamin);
  examsByPeriod.set(period, set);
}
for (const [period, set] of examsByPeriod) {
  if (!(set.has("LEK") && set.has("LDEK"))) fail(`${examPath}: okres ${period} nie zawiera pary LEK/LDEK.`);
}

const sd = parseCsv(readText(sdPath), sdPath);
const requiredSdHeaders = ["egzamin", "rok", "sesja", "odchylenie_standardowe_pkt", "zrodlo"];
for (const header of requiredSdHeaders) {
  if (!sd.headers.includes(header)) fail(`${sdPath}: brakuje kolumny ${header}.`);
}
const sdKeys = new Set();
for (let index = 0; index < sd.records.length; index += 1) {
  const record = sd.records[index];
  const row = index + 2;
  const key = `${record.egzamin}|${record.rok}|${record.sesja}`;
  if (sdKeys.has(key)) fail(`${sdPath}: zduplikowany rekord ${key}.`);
  sdKeys.add(key);
  if (!examKeys.has(key)) fail(`${sdPath}, wiersz ${row}: brak odpowiadającego wyniku egzaminu ${key}.`);
  const value = number(record.odchylenie_standardowe_pkt);
  if (value === null || value <= 0 || value > 100) fail(`${sdPath}, wiersz ${row}: niewiarygodne SD.`);
  if (!/^https:\/\/(www\.)?cem\.edu\.pl\//.test(record.zrodlo)) fail(`${sdPath}, wiersz ${row}: źródło nie jest oficjalnym adresem CEM.`);
}
for (const key of examKeys) {
  if (!sdKeys.has(key)) warn(`Brak opublikowanego lub wpisanego SD dla ${key}.`);
}

let manifest = [];
try {
  manifest = JSON.parse(readText(manifestPath));
  if (!Array.isArray(manifest)) fail(`${manifestPath}: korzeń JSON musi być tablicą.`);
} catch (error) {
  fail(`${manifestPath}: nieprawidłowy JSON (${error.message}).`);
}
const roundKeys = new Set();
for (const source of manifest) {
  if (!/^[wj]-\d{4}$/.test(source.rekrutacja ?? "")) fail(`${manifestPath}: błędny identyfikator rundy ${source.rekrutacja}.`);
  if (roundKeys.has(source.rekrutacja)) fail(`${manifestPath}: zduplikowana runda ${source.rekrutacja}.`);
  roundKeys.add(source.rekrutacja);
  if (!/^https:\/\/(www\.)?cmkp\.edu\.pl\//.test(source.url ?? "")) fail(`${manifestPath}: ${source.rekrutacja} nie wskazuje na oficjalną domenę CMKP.`);
  const pdfPath = path.join(root, "prediction", "sources", "cmkp_places_pdfs", `${source.rekrutacja}.pdf`);
  if (!fs.existsSync(pdfPath)) warn(`Brak pobranego PDF wykazu miejsc dla ${source.rekrutacja}.`);
  else if (fs.readFileSync(pdfPath).subarray(0, 4).toString("ascii") !== "%PDF") fail(`Plik ${source.rekrutacja}.pdf nie jest PDF-em.`);
}

const places = parseCsv(readText(placesPath), placesPath);
const placeRounds = new Set(places.records.map((record) => record.rekrutacja));
for (const round of roundKeys) {
  if (!placeRounds.has(round)) warn(`${placesPath}: brak sparsowanych miejsc dla ${round}.`);
}

const predictionDataPath = path.join(root, "prediction", "data");
const fillForecastFiles = fs.existsSync(predictionDataPath)
  ? fs.readdirSync(predictionDataPath).filter((name) => /^fill_forecast_.+\.csv$/.test(name))
  : [];
for (const fileName of fillForecastFiles) {
  const relativePath = `prediction/data/${fileName}`;
  const forecast = parseCsv(readText(relativePath), relativePath);
  const probabilityHeaders = forecast.headers.filter((header) => header.startsWith("prawdopodobienstwo_"));
  if (!probabilityHeaders.length) fail(`${relativePath}: brak kolumn prawdopodobieństwa.`);
  for (let index = 0; index < forecast.records.length; index += 1) {
    for (const header of probabilityHeaders) {
      const value = number(forecast.records[index][header]);
      if (value === null || value < 0 || value > 1) {
        fail(`${relativePath}, wiersz ${index + 2}: ${header} nie należy do [0, 1].`);
      }
    }
  }
}

const sourceDataPath = path.join(root, "source_data");
const resultFiles = fs.existsSync(sourceDataPath)
  ? fs.readdirSync(sourceDataPath).filter((name) => /^[wj]-\d{4}_parsed\.csv$/.test(name))
  : [];
const resultRounds = new Set(resultFiles.map((name) => name.replace("_parsed.csv", "")));
for (const round of roundKeys) {
  if (!resultRounds.has(round)) warn(`Brak listy wynikowej source_data/${round}_parsed.csv (może jeszcze nie być opublikowana).`);
}

const latestExam = [...exam.records].sort((a, b) => periodIndex(b.rok, b.sesja) - periodIndex(a.rok, a.sesja))[0];
const latestSd = [...sd.records].sort((a, b) => periodIndex(b.rok, b.sesja) - periodIndex(a.rok, a.sesja))[0];
const roundIndex = (round) => Number(round.slice(2)) * 2 + (round.startsWith("j-") ? 1 : 0);
const latestManifest = [...roundKeys].sort((a, b) => roundIndex(b) - roundIndex(a))[0] ?? null;
const latestResults = [...resultRounds].sort((a, b) => roundIndex(b) - roundIndex(a))[0] ?? null;

console.log(`AUDYT ŹRÓDEŁ (${new Date().toISOString()})`);
console.log(`CEM wyniki: ${exam.records.length} rekordów; najnowszy okres ${latestExam ? periodLabel(latestExam) : "brak"}.`);
console.log(`CEM SD: ${sd.records.length} rekordów; najnowszy okres ${latestSd ? periodLabel(latestSd) : "brak"}.`);
console.log(`CMKP miejsca: ${manifest.length} rund; najnowsza ${latestManifest ?? "brak"}.`);
console.log(`CMKP wyniki: ${resultFiles.length} rund; najnowsza ${latestResults ?? "brak"}.`);
console.log(`Prognozy zapełnienia: ${fillForecastFiles.length} plików ze sprawdzonym zakresem prawdopodobieństw.`);
for (const message of warnings) console.warn(`OSTRZEŻENIE: ${message}`);
for (const message of errors) console.error(`BŁĄD: ${message}`);
console.log(`Podsumowanie: ${errors.length} błędów, ${warnings.length} ostrzeżeń.`);
if (errors.length) process.exitCode = 1;

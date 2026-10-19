// Lokalny audyt danych strony: wykaz miejsc CMKP i listy wynikowe w source_data/.
// Nie pobiera niczego z internetu i niczego nie zmienia.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, "..");
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

const manifestPath = "data_pipeline/places/cmkp_places_manifest.json";
const placesPath = "source_data/cmkp_places.csv";

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
  const pdfPath = path.join(root, "data_pipeline", "places", "pdfs", `${source.rekrutacja}.pdf`);
  if (!fs.existsSync(pdfPath)) warn(`Brak pobranego PDF wykazu miejsc dla ${source.rekrutacja}.`);
  else if (fs.readFileSync(pdfPath).subarray(0, 4).toString("ascii") !== "%PDF") fail(`Plik ${source.rekrutacja}.pdf nie jest PDF-em.`);
}

const places = parseCsv(readText(placesPath), placesPath);
const placeRounds = new Set(places.records.map((record) => record.rekrutacja));
for (const round of roundKeys) {
  if (!placeRounds.has(round)) warn(`${placesPath}: brak sparsowanych miejsc dla ${round}.`);
}

const sourceDataPath = path.join(root, "source_data");
const resultFiles = fs.existsSync(sourceDataPath)
  ? fs.readdirSync(sourceDataPath).filter((name) => /^[wj]-\d{4}_parsed\.csv$/.test(name))
  : [];
const resultRounds = new Set(resultFiles.map((name) => name.replace("_parsed.csv", "")));
for (const round of roundKeys) {
  if (!resultRounds.has(round)) warn(`Brak listy wynikowej source_data/${round}_parsed.csv (może jeszcze nie być opublikowana).`);
}

const resultPdfDir = path.join(root, "data_pipeline", "results", "pdfs");
const resultPdfRounds = fs.existsSync(resultPdfDir)
  ? fs.readdirSync(resultPdfDir).filter((name) => /^[wj]-\d{4}\.pdf$/.test(name)).map((name) => name.replace(".pdf", ""))
  : [];
for (const round of resultPdfRounds) {
  if (!resultRounds.has(round)) warn(`PDF data_pipeline/results/pdfs/${round}.pdf nie ma odpowiadającego CSV w source_data (uruchom npm run data:parse-results).`);
}
for (const round of resultRounds) {
  if (!resultPdfRounds.includes(round)) warn(`Brak źródłowego PDF dla source_data/${round}_parsed.csv w data_pipeline/results/pdfs.`);
}

const roundIndex = (round) => Number(round.slice(2)) * 2 + (round.startsWith("j-") ? 1 : 0);
const latestManifest = [...roundKeys].sort((a, b) => roundIndex(b) - roundIndex(a))[0] ?? null;
const latestResults = [...resultRounds].sort((a, b) => roundIndex(b) - roundIndex(a))[0] ?? null;

console.log(`AUDYT ŹRÓDEŁ (${new Date().toISOString()})`);
console.log(`CMKP miejsca: ${manifest.length} rund; najnowsza ${latestManifest ?? "brak"}.`);
console.log(`CMKP wyniki: ${resultFiles.length} rund; najnowsza ${latestResults ?? "brak"}.`);
for (const message of warnings) console.warn(`OSTRZEŻENIE: ${message}`);
for (const message of errors) console.error(`BŁĄD: ${message}`);
console.log(`Podsumowanie: ${errors.length} błędów, ${warnings.length} ostrzeżeń.`);
if (errors.length) process.exitCode = 1;

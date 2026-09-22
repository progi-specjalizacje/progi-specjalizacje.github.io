import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const inputFile = path.join(root, "prediction", "data", "recruitment_model_dataset.csv");
const regionOutput = path.join(root, "prediction", "data", "model_scope_candidates.csv");
const specialtyOutput = path.join(root, "prediction", "data", "specialty_scope_summary.csv");

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
  const output = [columns.join(",")];
  output.push(...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")));
  fs.writeFileSync(filePath, `${output.join("\n")}\n`, "utf8");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
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

function summarize(rows, includeRegion) {
  const offered = rows.filter(
    (row) =>
      number(row.oferowane_miejsca_rezydenckie) > 0 &&
      row.status_konkurencyjnosci !== "wynik_niedostepny",
  );
  const observed = offered.filter((row) => row.ma_obserwowany_prog === "TAK");
  const full = offered.filter((row) => row.status_konkurencyjnosci === "pelna_pula_proxy_konkurencji");
  const fullWithThreshold = full.filter((row) => number(row.prog_min_proc) !== null);
  const acceptedCounts = observed.map((row) => number(row.liczba_zakwalifikowanych));
  const thresholds = fullWithThreshold.map((row) => number(row.prog_min_proc));
  const fillShare = offered.length ? full.length / offered.length : 0;
  const medianAccepted = median(acceptedCounts);
  const medianThreshold = median(thresholds);

  let pilotGroup = "C_poza_pilotazem";
  if (
    offered.length >= 5 &&
    full.length >= 4 &&
    fillShare >= 0.7 &&
    medianAccepted >= 3 &&
    medianThreshold >= 75
  ) {
    pilotGroup = "A_stabilny_pilotaz";
  } else if (
    offered.length >= 4 &&
    full.length >= 3 &&
    fillShare >= 0.6 &&
    medianThreshold >= 85
  ) {
    pilotGroup = "B_wysoki_prog_mala_pula";
  }

  return {
    dziedzina_medycyny: rows[0].dziedzina_medycyny,
    ...(includeRegion ? { wojewodztwo: rows[0].wojewodztwo } : {}),
    sciezka: rows[0].sciezka,
    egzamin: rows[0].egzamin,
    rundy_z_oferta: offered.length,
    rundy_z_obserwowanym_progiem: observed.length,
    rundy_z_pelna_pula: full.length,
    udzial_rund_z_pelna_pula: round(fillShare),
    mediana_liczby_miejsc: round(median(offered.map((row) => number(row.oferowane_miejsca_rezydenckie)))),
    mediana_liczby_zakwalifikowanych: round(medianAccepted),
    mediana_progu_pelnych_pul: round(medianThreshold),
    minimum_progu_pelnych_pul: thresholds.length ? Math.min(...thresholds) : null,
    maksimum_progu_pelnych_pul: thresholds.length ? Math.max(...thresholds) : null,
    grupa_pilotazowa: pilotGroup,
  };
}

const rows = readCsv(inputFile);
const regionRows = [...groupBy(rows, (row) => `${row.dziedzina_medycyny}::${row.wojewodztwo}`).values()]
  .map((group) => summarize(group, true))
  .sort(
    (a, b) =>
      a.grupa_pilotazowa.localeCompare(b.grupa_pilotazowa, "pl") ||
      (b.mediana_progu_pelnych_pul ?? -1) - (a.mediana_progu_pelnych_pul ?? -1) ||
      a.dziedzina_medycyny.localeCompare(b.dziedzina_medycyny, "pl"),
  );

const specialtyRows = [...groupBy(rows, (row) => row.dziedzina_medycyny).values()]
  .map((group) => {
    const summary = summarize(group, false);
    const regions = regionRows.filter((row) => row.dziedzina_medycyny === summary.dziedzina_medycyny);
    return {
      ...summary,
      regiony_stabilnego_pilotazu: regions.filter((row) => row.grupa_pilotazowa === "A_stabilny_pilotaz").length,
      regiony_wysokiego_progu_malej_puli: regions.filter(
        (row) => row.grupa_pilotazowa === "B_wysoki_prog_mala_pula",
      ).length,
    };
  })
  .sort(
    (a, b) =>
      b.regiony_stabilnego_pilotazu - a.regiony_stabilnego_pilotazu ||
      b.regiony_wysokiego_progu_malej_puli - a.regiony_wysokiego_progu_malej_puli ||
      (b.mediana_progu_pelnych_pul ?? -1) - (a.mediana_progu_pelnych_pul ?? -1),
  );

const sharedColumns = [
  "dziedzina_medycyny",
  "sciezka",
  "egzamin",
  "rundy_z_oferta",
  "rundy_z_obserwowanym_progiem",
  "rundy_z_pelna_pula",
  "udzial_rund_z_pelna_pula",
  "mediana_liczby_miejsc",
  "mediana_liczby_zakwalifikowanych",
  "mediana_progu_pelnych_pul",
  "minimum_progu_pelnych_pul",
  "maksimum_progu_pelnych_pul",
  "grupa_pilotazowa",
];

writeCsv(regionOutput, regionRows, [sharedColumns[0], "wojewodztwo", ...sharedColumns.slice(1)]);
writeCsv(specialtyOutput, specialtyRows, [
  ...sharedColumns,
  "regiony_stabilnego_pilotazu",
  "regiony_wysokiego_progu_malej_puli",
]);

console.log(
  `Zakres A: ${regionRows.filter((row) => row.grupa_pilotazowa === "A_stabilny_pilotaz").length}; ` +
    `zakres B: ${regionRows.filter((row) => row.grupa_pilotazowa === "B_wysoki_prog_mala_pula").length}.`,
);

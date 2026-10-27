// Eksportuje zamrożoną prognozę progów z archiwum (archive/prediction) do source_data/,
// skąd czyta ją scripts/preprocess.js. To kopia danych, nie uruchamianie kodu z archiwum.
// Użycie: node data_pipeline/forecast/export_forecast.mjs [runda]   (domyślnie j-2026)
//
// Surowa prognoza modelu jest tu dodatkowo zawężana ostrożnościowo (szansa pełnej puli pochodzi z modelu po korekcie z 2026-10, patrz archive/prediction/README.md):
//  - tylko LEK (stomatologia pominięta do czasu osobnego sprawdzenia modelu dla LDEK),
//  - pule bez żadnej historii pełnej puli są pomijane (model zgaduje tam średnią globalną),
//  - zakres 80% jest poszerzany o rozrzut wariantów modelu i zmienność własnej historii puli.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const round = process.argv[2] ?? "j-2026";
const dataDir = path.join(root, "archive/prediction/data");
const output = path.join(root, "source_data", `forecast_${round}.csv`);

const ROUND_ORDER = ["w-2023", "j-2023", "w-2024", "j-2024", "w-2025", "j-2025", "w-2026", "j-2026"];
const Z80 = 1.2816;

function splitLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv(file) {
  const lines = fs.readFileSync(file, "utf-8").trim().split(/\r?\n/);
  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

const num = (v) => (v === "" || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const csv = (v) => (String(v).includes(",") ? `"${v}"` : String(v));

const forecast = readCsv(path.join(dataDir, `threshold_forecast_${round}.csv`)).filter((r) => r.egzamin === "LEK");
const dataset = readCsv(path.join(dataDir, "recruitment_model_dataset.csv")).filter(
  (r) => r.egzamin === "LEK" && ROUND_ORDER.indexOf(r.rekrutacja) >= 0 && r.rekrutacja !== round,
);

// Historia progów konkurencyjnych każdej puli (pełnych obsad).
const poolHistory = new Map(); // `${woj}::${spec}` -> [progi]
for (const row of dataset) {
  const threshold = num(row.prog_min_proc);
  if (row.status_konkurencyjnosci === "pelna_pula_proxy_konkurencji" && threshold !== null) {
    const poolKey = `${row.wojewodztwo}::${row.dziedzina_medycyny}`;
    poolHistory.set(poolKey, [...(poolHistory.get(poolKey) ?? []), threshold]);
  }
}

const variantColumns = [
  "prognoza_bez_egzaminu",
  "prognoza_sezon_trend",
  "prognoza_zmiana_progu",
  "prognoza_z_egzaminem",
  "prognoza_trend_delta_laczony",
];

const keep = [
  "rekrutacja",
  "wojewodztwo",
  "dziedzina_medycyny",
  "sciezka",
  "liczba_miejsc",
  "poziom_pewnosci",
  "prawdopodobienstwo_pelnej_puli",
  "prognoza_modelowa",
  "dolna_granica_80_proc",
  "gorna_granica_80_proc",
];

let dropped = 0;
const rows = [];
for (const row of forecast) {
  const history = poolHistory.get(`${row.wojewodztwo}::${row.dziedzina_medycyny}`) ?? [];
  if (history.length === 0) {
    dropped += 1;
    continue;
  }

  const chance = num(row.prawdopodobienstwo_pelnej_puli) ?? 0;
  const point = num(row.prognoza_modelowa);
  const baseLow = num(row.dolna_granica_80_proc);
  const baseHigh = num(row.gorna_granica_80_proc);
  const variants = variantColumns.map((c) => num(row[c])).filter((v) => v !== null);
  const spread = variants.length > 1 ? Math.max(...variants) - Math.min(...variants) : 0;
  const historyHalf = history.length >= 3 ? Z80 * sd(history) : 0;
  const half = Math.max((baseHigh - baseLow) / 2, spread / 2, historyHalf);

  rows.push(
    [
      row.rekrutacja,
      row.wojewodztwo,
      row.dziedzina_medycyny,
      row.sciezka,
      row.liczba_miejsc,
      row.poziom_pewnosci,
      chance.toFixed(3),
      point,
      Math.max(0, point - half).toFixed(3),
      Math.min(100, point + half).toFixed(3),
    ]
      .map(csv)
      .join(","),
  );
}

fs.writeFileSync(output, [keep.join(","), ...rows].join("\n") + "\n", "utf-8");
console.log(
  `Zapisano ${rows.length} prognoz do ${path.relative(root, output)} ` +
    `(pominięto ${dropped} pul bez historii pełnej puli).`,
);

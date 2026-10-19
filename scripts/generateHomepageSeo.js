import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Generates the static SEO content of the homepage: threshold table, FAQ, <title>/description and sitemap.xml.
// The former per-specialty subpages generator lives in archive/seo-subpages/.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../public/data");
const SITEMAP_PATH = path.join(__dirname, "../public/sitemap.xml");
const SITE_URL = "https://progi-specjalizacje.pl";
const INDEX_HTML_PATH = path.join(__dirname, "../index.html");
const SUMMARY_START = "<!-- seo-homepage-summary:start -->";
const SUMMARY_END = "<!-- seo-homepage-summary:end -->";
const HOMEPAGE_SUMMARY_COUNT = 20;
const MODES = ["Rezydencki", "Pozarezydencki"];
const MAX_POINTS = { Rezydencki: 210, Pozarezydencki: 220 };

// Matches DENTAL_SPECIALTIES in src/config/specialtySearchFilter.ts (LDEK path in the app UI).
const DENTAL_SPECIALTIES = new Set([
  "Ortodoncja", "Protetyka stomatologiczna", "Chirurgia stomatologiczna",
  "Stomatologia zachowawcza z endodoncją", "Periodontologia", "Stomatologia dziecięca",
  "Chirurgia szczękowo-twarzowa", "Zdrowie publiczne"
]);

function average(values) {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function slugify(value) {
  return String(value).toLocaleLowerCase("pl")
    .replaceAll("ł", "l").replaceAll("ą", "a").replaceAll("ć", "c").replaceAll("ę", "e")
    .replaceAll("ń", "n").replaceAll("ó", "o").replaceAll("ś", "s").replaceAll("ź", "z").replaceAll("ż", "z")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function formatPercent(value) { return `${value.toFixed(2).replace(".", ",")}%`; }
function formatPoints(value, maxPoints) { return `${Math.round((value / 100) * maxPoints)} pkt`; }

function formatRecruitmentLabel(recruitment) {
  const match = String(recruitment).match(/^([wj])-(\d{4})$/i);
  if (!match) return String(recruitment);
  return `${match[1].toLocaleLowerCase("pl") === "w" ? "wiosna" : "jesień"} ${match[2]}`;
}

function countQualifiedApplicants(rows) {
  const unique = new Set();
  rows.forEach((row, index) => {
    const applicationId = String(row.numer_wniosku || "").trim();
    const recruitment = String(row.rekrutacja || "").trim();
    unique.add(applicationId ? `${recruitment}|${applicationId}` : `${recruitment}|row-${index}`);
  });
  return unique.size;
}

// Latest-round summary per training mode: offered places and the average competitive threshold
// (only provinces whose pool was fully filled count as a threshold).
function analyzeSpecialtyData(rows, pools) {
  const cleanedRows = rows.filter((row) => row.czy_miejsca_doktoranckie !== "TAK");
  const order = {};
  for (const row of cleanedRows) {
    if (row.rekrutacja && row.kolejnosc_plikow !== undefined) {
      order[row.rekrutacja] = Math.max(order[row.rekrutacja] ?? -Infinity, row.kolejnosc_plikow);
    }
  }
  const recruitments = [...new Set(cleanedRows.map((row) => row.rekrutacja).filter(Boolean))]
    .sort((a, b) => (order[b] || 0) - (order[a] || 0));
  const result = { metadata: { latestRecruitment: recruitments[0] } };

  for (const mode of MODES) {
    const modeRows = cleanedRows.filter((row) => row.tryb_szkolenia === mode);
    const modePools = pools.filter((pool) => pool.tryb_szkolenia === mode);
    const recruitment = recruitments.find((item) =>
      modeRows.some((row) => row.rekrutacja === item) || modePools.some((pool) => pool.rekrutacja === item));
    if (!recruitment) { result[mode] = null; continue; }
    const latestPools = modePools.filter((pool) => pool.rekrutacja === recruitment);
    const places = latestPools.map((pool) => pool.liczba_miejsc).filter(Number.isFinite);
    const thresholds = latestPools.filter((pool) => pool.status_konkurencyjnosci === "full")
      .map((pool) => pool.najnizszy_wynik_proc).filter(Number.isFinite);
    result[mode] = {
      maxPoints: MAX_POINTS[mode],
      history: [{
        recruitment,
        totalPlaces: places.length ? places.reduce((sum, value) => sum + value, 0) : Number.NaN,
        averageThreshold: thresholds.length ? average(thresholds) : Number.NaN
      }]
    };
  }
  return result;
}

function isDental(item) {
  return DENTAL_SPECIALTIES.has(item.specialtyName);
}

function reportUrl(slug, anchor) {
  return `/?specializacja=${encodeURIComponent(slug)}#${anchor}`;
}

// Date of the last committed source-data change (public/data is rebuilt on every build, so its mtime is meaningless).
// Requires full git history in CI; returns null rather than a misleading date.
function dataLastModified() {
  try {
    const date = execFileSync("git", ["log", "-1", "--format=%cs", "--", "source_data", "scripts/generateHomepageSeo.js"],
      { cwd: path.join(__dirname, ".."), encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
}

function writeSitemap() {
  const lastmod = dataLastModified();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>
</urlset>
`;
  fs.writeFileSync(SITEMAP_PATH, xml, "utf-8");
}

function summaryModeCells(item, mode, recruitment) {
  const data = item.analysis[mode];
  const latest = data?.history[0];
  if (!latest || latest.recruitment !== recruitment) return `<td>-</td><td>-</td>`;
  const places = Number.isFinite(latest.totalPlaces) ? Math.round(latest.totalPlaces) : "-";
  const threshold = Number.isFinite(latest.averageThreshold)
    ? `${formatPercent(latest.averageThreshold)} <small>(${formatPoints(latest.averageThreshold, data.maxPoints)})</small>`
    : "zostały wolne miejsca";
  return `<td>${places}</td><td>${threshold}</td>`;
}

// Statutory pay is derived from the GUS average monthly wage of the previous year and changes every 1 July.
// Add the new GUS figure (published each February) here; amounts and the effective date follow automatically.
const AVERAGE_WAGE_BY_YEAR = { 2025: 8903.56 };
const WORK_COEFFICIENTS = { intern: 0.95, doctorWithoutSpecialty: 1.19 };
// Multipliers of the base amount (1,19 × average wage) set by the Minister of Health regulation from 1 July 2026.
const RESIDENT_MULTIPLIERS = {
  priority: { firstTwoYears: 1.1, afterTwoYears: 1.2 },
  other: { firstTwoYears: 1.0, afterTwoYears: 1.03 }
};

function roundToGrosze(value) { return Math.round(value * 100) / 100; }

function formatPln(value) {
  const [whole, fraction] = value.toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${fraction} zł`;
}

function currentSalaryPeriod(today = new Date()) {
  const years = Object.keys(AVERAGE_WAGE_BY_YEAR).map(Number).sort((a, b) => b - a);
  const wageYear = years.find((year) => today >= new Date(year + 1, 6, 1)) ?? years[years.length - 1];
  const effectiveYear = wageYear + 1;
  if (today >= new Date(effectiveYear + 1, 6, 1)) {
    console.warn(`Brak przeciętnego wynagrodzenia GUS za ${effectiveYear} r. – FAQ pokazuje stawki od 1 lipca ${effectiveYear} r.`);
  }
  const base = roundToGrosze(AVERAGE_WAGE_BY_YEAR[wageYear] * WORK_COEFFICIENTS.doctorWithoutSpecialty);
  const resident = (group) => ({
    firstTwoYears: roundToGrosze(base * RESIDENT_MULTIPLIERS[group].firstTwoYears),
    afterTwoYears: roundToGrosze(base * RESIDENT_MULTIPLIERS[group].afterTwoYears)
  });
  return {
    wageYear, effectiveYear, averageWage: AVERAGE_WAGE_BY_YEAR[wageYear],
    intern: roundToGrosze(AVERAGE_WAGE_BY_YEAR[wageYear] * WORK_COEFFICIENTS.intern),
    priority: resident("priority"), other: resident("other")
  };
}

function renderHomepageFaq() {
  const salary = currentSalaryPeriod();
  const faq = [
    ["Jak liczone są punkty na specjalizację?",
      "Podstawą jest wynik z LEK (lub LDEK) – maksymalnie 200 punktów, mniej, jeśli z egzaminu unieważniono pytania. W trybie rezydenckim można dodać 5 punktów za stopień doktora oraz po 0,5 punktu za publikację (łącznie do 5 punktów), co daje maksymalnie 210 punktów. W trybie pozarezydenckim dochodzi jeszcze po 5 punktów za co najmniej 3 lata pracy i za pracę nauczyciela akademickiego – maksymalnie 220 punktów."],
    ["Ile procent z LEK trzeba mieć na specjalizację?",
      "To zależy od specjalizacji, województwa i naboru. Procent w tabeli liczony jest od maksymalnej liczby punktów w danym trybie (210 lub 220), więc uwzględnia też punkty dodatkowe. Swój wynik możesz przeliczyć w kalkulatorze i porównać z progami z poprzednich naborów."],
    ["Kiedy odbywają się nabory na specjalizacje?",
      "Postępowania kwalifikacyjne prowadzone są dwa razy w roku – w naborze wiosennym i jesiennym. Wyniki publikuje Centrum Medycznego Kształcenia Podyplomowego (CMKP)."],
    ["Ile zarabia się na rezydenturze?",
      `Od 1 lipca ${salary.effectiveYear} r. wynagrodzenie zasadnicze lekarza rezydenta wynosi brutto miesięcznie: w specjalizacjach priorytetowych ${formatPln(salary.priority.firstTwoYears)} w pierwszych dwóch latach i ${formatPln(salary.priority.afterTwoYears)} po dwóch latach, a w pozostałych specjalizacjach odpowiednio ${formatPln(salary.other.firstTwoYears)} i ${formatPln(salary.other.afterTwoYears)}. Kwoty liczone są od przeciętnego wynagrodzenia w gospodarce narodowej za ${salary.wageYear} r. (${formatPln(salary.averageWage)} według GUS) i rosną co roku od 1 lipca. Listę dziedzin priorytetowych określa rozporządzenie Ministra Zdrowia. Do pensji zasadniczej dochodzi zwykle wynagrodzenie za dyżury medyczne.`],
    ["Ile zarabia się na stażu podyplomowym?",
      `Od 1 lipca ${salary.effectiveYear} r. wynagrodzenie zasadnicze lekarza stażysty i lekarza dentysty stażysty wynosi ${formatPln(salary.intern)} brutto miesięcznie, czyli 0,95 przeciętnego wynagrodzenia w gospodarce narodowej za ${salary.wageYear} r. Kwota jest aktualizowana co roku od 1 lipca. Za dyżury medyczne pełnione w trakcie stażu przysługuje dodatkowe wynagrodzenie.`]
  ];
  return faq.map(([question, answer]) => `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join("\n        ");
}

// The homepage is a client-rendered SPA, so its raw HTML must carry real content for crawlers.
// Rendered outside #root, so it stays in the DOM after React mounts.
function writeHomepageSummary(items) {
  const html = fs.readFileSync(INDEX_HTML_PATH, "utf-8");
  const start = html.indexOf(SUMMARY_START);
  const end = html.indexOf(SUMMARY_END);
  if (start === -1 || end === -1) throw new Error(`Brak znaczników ${SUMMARY_START} / ${SUMMARY_END} w index.html`);
  const recruitment = items[0].analysis.metadata.latestRecruitment;
  const label = formatRecruitmentLabel(recruitment);
  const medical = items.filter((item) => !isDental(item)).slice(0, HOMEPAGE_SUMMARY_COUNT);
  const rows = medical.map((item) => `<tr><th scope="row"><a href="${reportUrl(item.slug, "raport")}">${escapeHtml(item.specialtyName)}</a></th>${MODES.map((mode) => summaryModeCells(item, mode, recruitment)).join("")}</tr>`).join("\n          ");
  const block = `${SUMMARY_START}
    <section class="seo-summary" aria-labelledby="seo-summary-title">
      <h2 id="seo-summary-title">Progi na specjalizacje lekarskie – nabór ${escapeHtml(label)}</h2>
      <p>Zestawienie progów konkurencyjnych na rezydenturę i w trybie pozarezydenckim dla ${HOMEPAGE_SUMMARY_COUNT} specjalizacji lekarskich z największą liczbą zakwalifikowanych osób. Próg to średnia z progów wojewódzkich – tylko z tych województw, w których obsadzono wszystkie miejsca; w nawiasie podano odpowiadającą mu liczbę punktów. Pełne dane dla każdego województwa, specjalizacji lekarskich i lekarsko-dentystycznych znajdziesz w raporcie powyżej.</p>
      <div class="seo-summary-table"><table>
        <thead><tr><th scope="col" rowspan="2">Specjalizacja</th><th scope="colgroup" colspan="2">Tryb rezydencki</th><th scope="colgroup" colspan="2">Tryb pozarezydencki</th></tr>
        <tr><th scope="col">Miejsca</th><th scope="col">Próg</th><th scope="col">Miejsca</th><th scope="col">Próg</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table></div>
      <h2>Najczęstsze pytania</h2>
      <div class="seo-faq">
        ${renderHomepageFaq()}
      </div>
    </section>
    `;
  const year = recruitment.slice(-4);
  const title = `Progi na specjalizacje lekarskie ${year} – rezydentura | LEK i LDEK`;
  const description = `Progi na specjalizacje lekarskie i stomatologiczne z naboru ${label}: progi na rezydenturę i w trybie pozarezydenckim, liczba miejsc w województwach, historia naborów i kalkulator punktów LEK/LDEK.`;
  const updated = (html.slice(0, start) + block + html.slice(end))
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapeHtml(description)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeHtml(title)}$2`);
  fs.writeFileSync(INDEX_HTML_PATH, updated, "utf-8");
}

function run() {
  console.log("Generowanie treści SEO strony głównej...");
  if (!fs.existsSync(DATA_DIR)) throw new Error(`Katalog z danymi nie istnieje: ${DATA_DIR}`);
  const files = fs.readdirSync(DATA_DIR).filter((file) => file.startsWith("specialty_") && file.endsWith(".json"));
  const items = files.map((file) => {
    const rows = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
    const poolsPath = path.join(DATA_DIR, file.replace(/^specialty_/, "pools_"));
    const pools = fs.existsSync(poolsPath) ? JSON.parse(fs.readFileSync(poolsPath, "utf-8")) : [];
    const specialtyName = rows[0]?.dziedzina_medycyny || file;
    return { specialtyName, slug: slugify(specialtyName), totalQualified: countQualifiedApplicants(rows), analysis: analyzeSpecialtyData(rows, pools) };
  }).filter((item) => item.analysis.Rezydencki || item.analysis.Pozarezydencki)
    .sort((a, b) => b.totalQualified - a.totalQualified || a.specialtyName.localeCompare(b.specialtyName, "pl"));
  writeHomepageSummary(items);
  writeSitemap();
  console.log(`Zaktualizowano index.html (${Math.min(HOMEPAGE_SUMMARY_COUNT, items.filter((item) => !isDental(item)).length)} specjalizacji w tabeli) oraz sitemap.xml.`);
}

run();

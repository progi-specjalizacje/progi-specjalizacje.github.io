import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../public/data");
const OUTPUT_DIR = path.join(__dirname, "../public/specjalizacje");
const OUTPUT_MARKER = path.join(OUTPUT_DIR, ".generated-seo-pages");
const SITEMAP_PATH = path.join(__dirname, "../public/sitemap-specializacje.xml");
const SITE_URL = "https://progi-specjalizacje.pl";
const INDEX_HTML_PATH = path.join(__dirname, "../index.html");
const LINKS_START = "<!-- seo-specialty-links:start -->";
const LINKS_END = "<!-- seo-specialty-links:end -->";

// Matches DENTAL_SPECIALTIES in src/config/specialtySearchFilter.ts (LDEK path in the app UI).
const DENTAL_SPECIALTIES = new Set([
  "Ortodoncja", "Protetyka stomatologiczna", "Chirurgia stomatologiczna",
  "Stomatologia zachowawcza z endodoncją", "Periodontologia", "Stomatologia dziecięca",
  "Chirurgia szczękowo-twarzowa", "Zdrowie publiczne"
]);
const RELATED_SPECIALTY_COUNT = 6;
const STATUS_LABELS = {
  full: "Próg konkurencyjny", underfilled: "Wolne miejsca", no_accepted: "Wolne miejsca"
};

const EXCLUDED_SPECIALTY_COUNT = 20;
const SIMILAR_THRESHOLD_TOLERANCE = 1;
const MODES = ["Rezydencki", "Pozarezydencki"];
const HISTORY_HEADERS = [
  "Rekrutacja", "Liczba oferowanych miejsc", "Uśredniony próg konkurencyjny (%)"
];
const REGION_LOCATIVE = {
  "dolnośląskie": "dolnośląskim", "kujawsko-pomorskie": "kujawsko-pomorskim",
  "lubelskie": "lubelskim", "lubuskie": "lubuskim", "łódzkie": "łódzkim",
  "małopolskie": "małopolskim", "mazowieckie": "mazowieckim", "opolskie": "opolskim",
  "podkarpackie": "podkarpackim", "podlaskie": "podlaskim", "pomorskie": "pomorskim",
  "śląskie": "śląskim", "świętokrzyskie": "świętokrzyskim",
  "warmińsko-mazurskie": "warmińsko-mazurskim", "wielkopolskie": "wielkopolskim",
  "zachodniopomorskie": "zachodniopomorskim"
};

function average(values) {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function median(values) {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) return 0;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
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

function formatPercent(value) { return `${value.toFixed(2)}%`; }
function formatPoints(value, maxPoints) { return `${Math.round((value / 100) * maxPoints)} pkt`; }

function formatRecruitmentLabel(recruitment) {
  const match = String(recruitment).match(/^([wj])-(\d{4})$/i);
  if (!match) return String(recruitment);
  return `${match[1].toLocaleLowerCase("pl") === "w" ? "wiosna" : "jesień"} ${match[2]}`;
}

function joinPolishList(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} i ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} i ${items.at(-1)}`;
}

function formatRegionLabel(regions) {
  const labels = regions.map((region) => {
    const normalized = String(region).trim().toLocaleLowerCase("pl");
    return REGION_LOCATIVE[normalized] || normalized;
  });
  return `${labels.length === 1 ? "w województwie" : "w województwach"} ${joinPolishList(labels)}`;
}

function formatPolishCount(value, forms) {
  const rounded = Math.round(value);
  const lastTwo = rounded % 100;
  const last = rounded % 10;
  const form = rounded === 1 ? forms[0] : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? forms[1] : forms[2];
  return `${rounded} ${form}`;
}

function formatPlaces(value) { return formatPolishCount(value, ["miejsce", "miejsca", "miejsc"]); }
function formatPeople(value) { return formatPolishCount(value, ["osoba", "osoby", "osób"]); }

function countQualifiedApplicants(rows) {
  const unique = new Set();
  rows.forEach((row, index) => {
    const applicationId = String(row.numer_wniosku || "").trim();
    const recruitment = String(row.rekrutacja || "").trim();
    unique.add(applicationId ? `${recruitment}|${applicationId}` : `${recruitment}|row-${index}`);
  });
  return unique.size;
}

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
  const result = {};

  for (const mode of MODES) {
    const maxPoints = mode === "Rezydencki" ? 210 : 220;
    const modeRows = cleanedRows.filter((row) => row.tryb_szkolenia === mode);
    const modePools = pools.filter((pool) => pool.tryb_szkolenia === mode);
    if (!modeRows.length && !modePools.length) { result[mode] = null; continue; }
    const history = [];
    const regionalStats = {};

    for (const recruitment of recruitments) {
      const recruitmentRows = modeRows.filter((row) => row.rekrutacja === recruitment);
      const recruitmentPools = modePools.filter((pool) => pool.rekrutacja === recruitment);
      if (!recruitmentRows.length && !recruitmentPools.length) continue;
      const regions = [...new Set(recruitmentPools.map((pool) => pool.wojewodztwo).filter(Boolean))];
      const regionalPlaces = {};
      const regionalThresholds = {};

      for (const region of regions) {
        const pool = recruitmentPools.find((item) => item.wojewodztwo === region);
        const places = pool?.liczba_miejsc;
        const threshold = pool?.status_konkurencyjnosci === "full" ? pool.najnizszy_wynik_proc : null;
        regionalPlaces[region] = places;
        regionalStats[region] ||= { minScores: [], totalPlaces: 0 };
        if (Number.isFinite(threshold)) {
          regionalThresholds[region] = threshold;
          regionalStats[region].minScores.push(threshold);
        }
        if (Number.isFinite(places)) regionalStats[region].totalPlaces += places;
      }

      const thresholdValues = Object.values(regionalThresholds);
      const placeValues = Object.values(regionalPlaces).filter(Number.isFinite);

      history.push({
        recruitment,
        totalPlaces: placeValues.length ? placeValues.reduce((sum, value) => sum + value, 0) : Number.NaN,
        averageThreshold: thresholdValues.length ? average(thresholdValues) : Number.NaN,
        meanScore: average(recruitmentRows.map((row) => row.punktacja_proc)),
        lowestScore: Math.min(...recruitmentRows.map((row) => row.punktacja_proc))
      });
    }

    if (!history.length) { result[mode] = null; continue; }
    const latestRecruitment = history[0].recruitment;
    const latestPools = modePools.filter((pool) => pool.rekrutacja === latestRecruitment);
    const latestRegionalDetails = latestPools
      .filter((pool) => Number.isFinite(pool.liczba_miejsc))
      .map((pool) => ({
        region: pool.wojewodztwo, places: pool.liczba_miejsc, status: pool.status_konkurencyjnosci,
        threshold: pool.status_konkurencyjnosci === "full" ? pool.najnizszy_wynik_proc : null
      }))
      .sort((a, b) => b.places - a.places || a.region.localeCompare(b.region, "pl"));

    const spring = history.filter((item) => item.recruitment.startsWith("w-") && Number.isFinite(item.averageThreshold));
    const autumn = history.filter((item) => item.recruitment.startsWith("j-") && Number.isFinite(item.averageThreshold));
    let seasonality = null;
    if (spring.length && autumn.length) {
      const springThreshold = average(spring.map((item) => item.averageThreshold));
      const autumnThreshold = average(autumn.map((item) => item.averageThreshold));
      const difference = Math.abs(autumnThreshold - springThreshold);
      seasonality = {
        springPlaces: average(spring.map((item) => item.totalPlaces)),
        autumnPlaces: average(autumn.map((item) => item.totalPlaces)),
        higherSeason: autumnThreshold > springThreshold ? "jesienią" : "wiosną",
        lowerSeason: autumnThreshold > springThreshold ? "wiosną" : "jesienią",
        difference, pointsDifference: (difference / 100) * maxPoints
      };
    }

    const regionalAverages = Object.entries(regionalStats).filter(([, data]) => data.minScores.length).map(([region, data]) => ({
      region, averageThreshold: average(data.minScores), totalPlaces: data.totalPlaces
    }));
    const highest = Math.max(...regionalAverages.map((item) => item.averageThreshold));
    const lowest = Math.min(...regionalAverages.map((item) => item.averageThreshold));
    const mostPlaces = Math.max(...regionalAverages.map((item) => item.totalPlaces));

    result[mode] = {
      maxPoints, history, latestRecruitment, latestRegionalDetails, seasonality, mostPlaces,
      doctoralQualifiedCount: countQualifiedApplicants(rows.filter((row) => row.tryb_szkolenia === mode && row.czy_miejsca_doktoranckie === "TAK")),
      hardestRegions: regionalAverages.filter((item) => highest - item.averageThreshold <= SIMILAR_THRESHOLD_TOLERANCE)
        .sort((a, b) => b.averageThreshold - a.averageThreshold || a.region.localeCompare(b.region, "pl")),
      easiestRegions: regionalAverages.filter((item) => item.averageThreshold - lowest <= SIMILAR_THRESHOLD_TOLERANCE)
        .sort((a, b) => a.averageThreshold - b.averageThreshold || a.region.localeCompare(b.region, "pl")),
      mostPlacesRegions: regionalAverages.filter((item) => item.totalPlaces === mostPlaces).sort((a, b) => a.region.localeCompare(b.region, "pl"))
    };
  }
  result.metadata = { latestRecruitment: recruitments[0], oldestRecruitment: recruitments.at(-1) };
  return result;
}

function thresholdRangeHtml(regions, maxPoints) {
  const values = regions.map((item) => item.averageThreshold).sort((a, b) => a - b);
  const min = values[0];
  const max = values.at(-1);
  if (Math.abs(max - min) < 0.005) return `<strong>${formatPercent(max)}</strong>, czyli około <strong>${formatPoints(max, maxPoints)}</strong>`;
  return `od <strong>${formatPercent(min)}</strong> do <strong>${formatPercent(max)}</strong>, czyli od około <strong>${formatPoints(min, maxPoints)}</strong> do <strong>${formatPoints(max, maxPoints)}</strong>`;
}

function renderSummary(mode, data) {
  const latest = data.history[0];
  const hasThreshold = Number.isFinite(latest.averageThreshold);
  const examPoints = hasThreshold ? Math.round((latest.averageThreshold / 100) * 200) : null;
  return `<div class="summary-group" aria-labelledby="summary-${slugify(mode)}">
    <div class="summary-heading"><h3 id="summary-${slugify(mode)}">${escapeHtml(data.name)} - tryb ${escapeHtml(mode.toLocaleLowerCase("pl"))}</h3><span>${escapeHtml(formatRecruitmentLabel(data.latestRecruitment))}</span></div>
    <div class="metric-grid">
      <article class="metric"><strong>${Number.isFinite(latest.totalPlaces) ? Math.round(latest.totalPlaces) : "—"}</strong><span>liczba oferowanych miejsc</span></article>
      <article class="metric"><strong>${hasThreshold ? formatPercent(latest.averageThreshold) : "brak progu"}</strong><span>uśredniony próg konkurencyjny</span></article>
    </div>${hasThreshold ? `<p class="exam-equivalent">Co odpowiada wynikowi ok. <strong>${examPoints} pkt</strong> z egzaminu końcowego.*</p>` : ""}</div>`;
}

function renderHistoryTable(data) {
  const rows = data.history.map((row) => `<tr><th scope="row">${escapeHtml(formatRecruitmentLabel(row.recruitment))}</th>
    <td>${Number.isFinite(row.totalPlaces) ? Math.round(row.totalPlaces) : "—"}</td><td>${Number.isFinite(row.averageThreshold) ? formatPercent(row.averageThreshold) : "brak progu"}</td></tr>`).join("");
  return `<div class="table-scroll" tabindex="0"><table><thead><tr>${HISTORY_HEADERS.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderSeasonality(data) {
  if (!data.seasonality) return `<li>Dostępne dane nie pozwalają jeszcze porównać rekrutacji wiosennych i jesiennych. Specjalizacja była dostępna tylko w jednym rodzaju naboru.</li>`;
  const item = data.seasonality;
  return `<li>Średnia liczba miejsc w naborach wiosennych wynosiła <strong>${item.springPlaces.toFixed(1)}</strong>, a w naborach jesiennych <strong>${item.autumnPlaces.toFixed(1)}</strong> na rekrutację.</li>
    <li>Średni próg ${item.higherSeason} był wyższy niż ${item.lowerSeason} o <strong>${item.difference.toFixed(2)} p.p.</strong>.</li>`;
}

function renderRegionalAnalysis(data) {
  if (!data.hardestRegions.length) return `<li>Dostępne dane nie pozwalają wyznaczyć konkurencyjnego progu regionalnego.</li>`;
  const hardest = formatRegionLabel(data.hardestRegions.map((item) => item.region));
  return `<li>Historycznie najwyższe progi występowały <strong>${escapeHtml(hardest)}</strong>: ${thresholdRangeHtml(data.hardestRegions, data.maxPoints)}.</li>`;
}

function renderRegionalTable(data) {
  if (!data.latestRegionalDetails.length) return "";
  const rows = data.latestRegionalDetails.map((item) => `<tr><th scope="row">${escapeHtml(item.region)}</th><td>${Math.round(item.places)}</td>
    <td>${Number.isFinite(item.threshold) ? `${formatPercent(item.threshold)} (${formatPoints(item.threshold, data.maxPoints)})` : escapeHtml(STATUS_LABELS[item.status] || "brak danych")}</td></tr>`).join("");
  return `<h3>Miejsca i progi w województwach – ${escapeHtml(formatRecruitmentLabel(data.latestRecruitment))}</h3>
    <div class="table-scroll" tabindex="0"><table><thead><tr><th scope="col">Województwo</th><th scope="col">Liczba miejsc</th><th scope="col">Próg konkurencyjny</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderModeSection(name, mode, data) {
  const doctoral = data.doctoralQualifiedCount > 0
    ? `<li>Poza przedstawionymi danymi w analizowanym okresie na miejsca doktoranckie zakwalifikowano <strong>${formatPeople(data.doctoralQualifiedCount)}</strong>.</li>`
    : "";
  return `<section class="content-section mode-overview" id="${slugify(mode)}"><h2>${escapeHtml(name)} – tryb ${escapeHtml(mode.toLocaleLowerCase("pl"))}</h2>
    <ul class="facts">${renderSeasonality(data)}${renderRegionalAnalysis(data)}${doctoral}</ul>
    ${renderRegionalTable(data)}
    <h3>Historyczne progi i liczba miejsc</h3><p>Poniższa tabela przedstawia wyniki dla specjalizacji <strong>${escapeHtml(name)}</strong> w kolejnych naborach.</p>${renderHistoryTable(data)}</section>`;
}

function isDental(item) {
  return DENTAL_SPECIALTIES.has(item.specialtyName);
}

// Neighbours by popularity within the same exam path, so every page links to and is linked from several others.
function relatedSpecialties(item, allItems) {
  const group = allItems.filter((other) => isDental(other) === isDental(item));
  const index = group.indexOf(item);
  return group.filter((other) => other !== item)
    .sort((a, b) => Math.abs(group.indexOf(a) - index) - Math.abs(group.indexOf(b) - index))
    .slice(0, RELATED_SPECIALTY_COUNT)
    .sort((a, b) => a.specialtyName.localeCompare(b.specialtyName, "pl"));
}

function renderRelated(item, allItems) {
  const related = relatedSpecialties(item, allItems);
  if (!related.length) return "";
  return `<section class="content-section"><h2>Progi na inne specjalizacje ${isDental(item) ? "lekarsko-dentystyczne" : "lekarskie"}</h2>
    <div class="specialty-list">${related.map((other) => `<a href="/specjalizacje/${other.slug}/"><strong>${escapeHtml(other.specialtyName)}</strong><span>progi punktowe i liczba miejsc</span></a>`).join("")}</div>
    <p><a href="/specjalizacje/">Zobacz wszystkie specjalizacje</a></p></section>`;
}

function breadcrumbJsonLd(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, pathname], index) => ({ "@type": "ListItem", position: index + 1, name, item: `${SITE_URL}${pathname}` }))
  };
}

function jsonLdScript(graph) {
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>`;
}

function canonicalTag(pathname) {
  return SITE_URL ? `<link rel="canonical" href="${escapeHtml(`${SITE_URL}${pathname}`)}">` : "";
}

function reportUrl(slug, anchor) {
  return `/?specializacja=${encodeURIComponent(slug)}#${anchor}`;
}

function latestModeFacts(analysis) {
  const parts = MODES.filter((mode) => analysis[mode]).map((mode) => {
    const latest = analysis[mode].history[0];
    const places = Number.isFinite(latest.totalPlaces) ? `${formatPlaces(latest.totalPlaces)}` : null;
    const threshold = Number.isFinite(latest.averageThreshold) ? `próg ok. ${formatPercent(latest.averageThreshold)}` : null;
    const details = [places, threshold].filter(Boolean).join(", ");
    return details ? `${mode.toLocaleLowerCase("pl")}: ${details}` : null;
  }).filter(Boolean);
  return parts.join("; ");
}

function renderSpecialtyPage(item, allItems) {
  const { specialtyName: name, slug, analysis } = item;
  const safeName = escapeHtml(name);
  const oldest = formatRecruitmentLabel(analysis.metadata.oldestRecruitment);
  const latest = formatRecruitmentLabel(analysis.metadata.latestRecruitment);
  const latestYear = String(analysis.metadata.latestRecruitment).slice(-4);
  const exam = isDental(item) ? "LDEK" : "LEK";
  const title = `${name} – progi na specjalizację ${latestYear} (${exam}) | miejsca i wyniki`;
  const facts = latestModeFacts(analysis);
  const description = `${name}: progi punktowe i liczba miejsc w rekrutacji ${latest}${facts ? ` (${facts})` : ""}. Historia naborów od ${oldest}, dane według województw i kalkulator punktów.`;
  const pathname = `/specjalizacje/${slug}/`;
  const reportHref = reportUrl(slug, "raport");
  const calculatorHref = reportUrl(slug, "kalkulator");
  const structuredData = jsonLdScript([
    { "@type": "WebPage", name: title, description, inLanguage: "pl-PL", url: `${SITE_URL}${pathname}` },
    breadcrumbJsonLd([["Strona główna", "/"], ["Specjalizacje", "/specjalizacje/"], [name, pathname]])
  ]);
  const summaries = MODES.filter((mode) => analysis[mode]).map((mode) => renderSummary(mode, { ...analysis[mode], name })).join("");
  const sections = MODES.filter((mode) => analysis[mode]).map((mode) => renderModeSection(name, mode, analysis[mode])).join("");

  return `<!doctype html><html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="index,follow">
    ${canonicalTag(pathname)}<link rel="stylesheet" href="/seo-pages.css">${structuredData}</head><body>
    <header class="site-header"><a class="brand" href="/">Progi specjalizacyjne</a></header>
    <main><nav class="breadcrumbs" aria-label="Okruszki"><a href="/">Strona główna</a><span>/</span><a href="/specjalizacje/">Specjalizacje</a><span>/</span><span>${safeName}</span></nav>
    <section class="hero"><p class="eyebrow">Dane rekrutacyjne ${escapeHtml(oldest)} – ${escapeHtml(latest)}</p><h1>${safeName} – progi na specjalizację i wyniki rekrutacji</h1>
      <p class="lead">Sprawdź historyczne progi punktowe, liczbę miejsc oraz wyniki rekrutacji dla specjalizacji <strong>${safeName}</strong>.</p>
      <div class="actions"><a class="button button-primary" href="${reportHref}">Otwórz pełny raport dla: ${safeName}</a></div>
      <p class="action-copy">Oblicz swój wynik i sprawdź, na ile miejsc w poprzednich rekrutacjach byłby wystarczający.</p></section>
    <section class="content-section latest"><h2>Dane z ostatniej zakończonej rekrutacji – ${escapeHtml(latest)}</h2>${summaries}
      <p class="footnote">*Orientacyjne przeliczenie progu procentowego. Szczegółowe składniki punktacji znajdziesz w kalkulatorze.</p></section>
    ${sections}
    ${renderRelated(item, allItems)}
    <section class="cta-panel"><div><p class="eyebrow">Interaktywny raport</p><h2>Porównaj swój wynik z poprzednimi rekrutacjami</h2><p>Wybierz specjalizację, tryb szkolenia, nabór i województwo, aby zobaczyć pełne dane oraz symulację.</p></div>
      <div class="actions"><a class="button button-secondary" href="${calculatorHref}">Przejdź do kalkulatora</a></div></section>
    </main>
    <footer class="site-footer"><div>Dane w raportach pochodzą z <a href="https://www.cmkp.edu.pl/ksztalcenie/postepowania-kwalifikacyjne">Centrum Medycznego Kształcenia Podyplomowego</a>.</div><div>Raport ma charakter informacyjny i został przygotowany na podstawie publicznie dostępnych danych. W przypadku rozbieżności wiążące są informacje publikowane przez CMKP. Strona jest prywatną inicjatywą i nie jest powiązana z CMKP ani żadną inną instytucją publiczną.</div><div><a href="${reportHref}">Otwórz pełny raport</a> <a href="/specjalizacje/">Wszystkie specjalizacje</a></div><div>kontakt: <a href="mailto:stenzelpawel.t@gmail.com">stenzelpawel.t@gmail.com</a></div><div>ostatnia aktualizacja: <time datetime="2026-09">09.2026</time></div></footer></body></html>`;
}

function renderDirectorySection(heading, items) {
  if (!items.length) return "";
  return `<section class="content-section"><h2>${escapeHtml(heading)}</h2><div class="specialty-list">${[...items].sort((a, b) => a.specialtyName.localeCompare(b.specialtyName, "pl"))
    .map((item) => `<a href="/specjalizacje/${item.slug}/"><strong>${escapeHtml(item.specialtyName)}</strong><span>${formatPeople(item.totalQualified)} zakwalifikowanych w analizowanym okresie</span></a>`).join("")}</div></section>`;
}

function renderDirectoryPage(items) {
  const title = "Progi na specjalizacje lekarskie i stomatologiczne – lista specjalizacji";
  const description = "Lista specjalizacji lekarskich (LEK) i lekarsko-dentystycznych (LDEK) z progami punktowymi, liczbą miejsc i historycznymi wynikami rekrutacji CMKP.";
  const structuredData = jsonLdScript([
    {
      "@type": "CollectionPage", name: title, description, inLanguage: "pl-PL", url: `${SITE_URL}/specjalizacje/`,
      mainEntity: { "@type": "ItemList", itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.specialtyName, url: `${SITE_URL}/specjalizacje/${item.slug}/` })) }
    },
    breadcrumbJsonLd([["Strona główna", "/"], ["Specjalizacje", "/specjalizacje/"]])
  ]);
  return `<!doctype html><html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
    <meta name="robots" content="index,follow">${canonicalTag("/specjalizacje/")}<link rel="stylesheet" href="/seo-pages.css">${structuredData}</head><body>
    <header class="site-header"><a class="brand" href="/">Progi specjalizacyjne</a></header><main>
    <nav class="breadcrumbs" aria-label="Okruszki"><a href="/">Strona główna</a><span>/</span><span>Specjalizacje</span></nav>
    <section class="hero"><h1>Progi na specjalizacje lekarskie i stomatologiczne</h1>
      <p class="lead">Wybierz specjalizację, aby zobaczyć progi punktowe, liczbę miejsc w województwach i wyniki kolejnych naborów w trybie rezydenckim i pozarezydenckim.</p>
      <div class="actions"><a class="button button-primary" href="/#kalkulator">Oblicz swoje punkty w kalkulatorze</a></div></section>
    ${renderDirectorySection("Specjalizacje lekarskie (LEK)", items.filter((item) => !isDental(item)))}
    ${renderDirectorySection("Specjalizacje lekarsko-dentystyczne (LDEK)", items.filter(isDental))}</main>
    <footer class="site-footer"><div>Dane w raportach pochodzą z <a href="https://www.cmkp.edu.pl/ksztalcenie/postepowania-kwalifikacyjne">Centrum Medycznego Kształcenia Podyplomowego</a>.</div><div>Raport ma charakter informacyjny i został przygotowany na podstawie publicznie dostępnych danych. W przypadku rozbieżności wiążące są informacje publikowane przez CMKP. Strona jest prywatną inicjatywą i nie jest powiązana z CMKP ani żadną inną instytucją publiczną.</div><div><a href="/">Wróć do strony głównej</a></div><div>kontakt: <a href="mailto:stenzelpawel.t@gmail.com">stenzelpawel.t@gmail.com</a></div><div>ostatnia aktualizacja: <time datetime="2026-09">09.2026</time></div></footer></body></html>`;
}

function prepareOutputDirectory() {
  if (fs.existsSync(OUTPUT_DIR)) {
    if (!fs.existsSync(OUTPUT_MARKER)) throw new Error(`Odmowa wyczyszczenia katalogu bez znacznika generatora: ${OUTPUT_DIR}`);
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_MARKER, "Katalog generowany automatycznie przez scripts/generateSeoPages.js.\n", "utf-8");
}

// Date of the last committed source-data change (public/data is rebuilt on every build, so its mtime is meaningless).
// Requires full git history in CI; returns null rather than a misleading date.
function dataLastModified() {
  try {
    const date = execFileSync("git", ["log", "-1", "--format=%cs", "--", "source_data", "scripts/generateSeoPages.js"],
      { cwd: path.join(__dirname, ".."), encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
}

function writeSitemap(items) {
  const lastmod = dataLastModified();
  const urls = ["/specjalizacje/", ...items.map((item) => `/specjalizacje/${item.slug}/`)];
  const entry = (pathname) => `  <url><loc>${escapeHtml(`${SITE_URL}${pathname}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(entry).join("\n")}\n</urlset>\n`;
  fs.writeFileSync(SITEMAP_PATH, xml, "utf-8");
  // Preserve the sitemap URL already used by the existing website.
  const mainXml = xml.replace('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entry("/")}`);
  fs.writeFileSync(path.join(__dirname, "../public/sitemap.xml"), mainXml, "utf-8");
}

// The homepage is a client-rendered SPA, so its raw HTML must carry plain links for crawlers to discover subpages.
function writeHomepageLinks(items) {
  const html = fs.readFileSync(INDEX_HTML_PATH, "utf-8");
  const start = html.indexOf(LINKS_START);
  const end = html.indexOf(LINKS_END);
  if (start === -1 || end === -1) throw new Error(`Brak znaczników ${LINKS_START} / ${LINKS_END} w index.html`);
  const list = (group) => group.map((item) => `<li><a href="/specjalizacje/${item.slug}/">${escapeHtml(item.specialtyName)}</a></li>`).join("");
  const sorted = [...items].sort((a, b) => a.specialtyName.localeCompare(b.specialtyName, "pl"));
  const block = `${LINKS_START}
    <nav class="seo-specialty-links" aria-labelledby="seo-specialty-links-title">
      <h2 id="seo-specialty-links-title">Progi na specjalizacje</h2>
      <h3>Lekarskie (LEK)</h3><ul>${list(sorted.filter((item) => !isDental(item)))}</ul>
      <h3>Lekarsko-dentystyczne (LDEK)</h3><ul>${list(sorted.filter(isDental))}</ul>
      <p><a href="/specjalizacje/">Wszystkie specjalizacje</a></p>
    </nav>
    `;
  fs.writeFileSync(INDEX_HTML_PATH, html.slice(0, start) + block + html.slice(end), "utf-8");
}

function run() {
  console.log("Generowanie statycznych podstron specjalizacji...");
  if (!fs.existsSync(DATA_DIR)) throw new Error(`Katalog z danymi nie istnieje: ${DATA_DIR}`);
  const files = fs.readdirSync(DATA_DIR).filter((file) => file.startsWith("specialty_") && file.endsWith(".json"));
  const ranked = files.map((file) => {
    const rows = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
    const poolsFile = file.replace(/^specialty_/, "pools_");
    const poolsPath = path.join(DATA_DIR, poolsFile);
    const pools = fs.existsSync(poolsPath) ? JSON.parse(fs.readFileSync(poolsPath, "utf-8")) : [];
    const specialtyName = rows[0]?.dziedzina_medycyny || file;
    return { rows, pools, specialtyName, slug: slugify(specialtyName), totalQualified: countQualifiedApplicants(rows) };
  }).sort((a, b) => b.totalQualified - a.totalQualified || a.specialtyName.localeCompare(b.specialtyName, "pl"));
  const included = ranked.slice(0, Math.max(0, ranked.length - EXCLUDED_SPECIALTY_COUNT));
  const excluded = ranked.slice(-EXCLUDED_SPECIALTY_COUNT);
  prepareOutputDirectory();

  const generated = [];
  for (const specialty of included) {
    const analysis = analyzeSpecialtyData(specialty.rows, specialty.pools);
    if (!analysis.Rezydencki && !analysis.Pozarezydencki) continue;
    generated.push({ ...specialty, analysis });
  }
  for (const page of generated) {
    const output = path.join(OUTPUT_DIR, page.slug);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "index.html"), renderSpecialtyPage(page, generated), "utf-8");
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), renderDirectoryPage(generated), "utf-8");
  writeSitemap(generated);
  writeHomepageLinks(generated);
  console.log(`Wygenerowano ${generated.length} podstron HTML oraz katalog specjalizacji.`);
  console.log(`Pominięto ${excluded.length} specjalizacji z najmniejszą łączną liczbą zakwalifikowanych:`);
  excluded.forEach((item) => console.log(`- ${item.specialtyName}: ${item.totalQualified}`));
}

run();

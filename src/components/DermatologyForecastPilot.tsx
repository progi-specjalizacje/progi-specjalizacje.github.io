import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, CheckCircle2, Info, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import forecastCsv from "../../prediction/data/threshold_forecast_j-2026.csv?raw";
import nationalForecastCsv from "../../prediction/data/national_threshold_forecast_j-2026.csv?raw";
import { fetchSpecialtyPools } from "../data/reportData";
import type { RecruitmentPool } from "../types";

interface ForecastRow {
  wojewodztwo: string;
  liczbaMiejsc: number;
  pewnosc: "wyzszy" | "sredni" | "niski";
  prawdopodobienstwoPelnejPuli: number;
  historycznePelnePule: number;
  grupaPilotazowa: string;
  prognoza: number;
  dolnaGranica: number;
  gornaGranica: number;
}

interface HistoricalRow {
  rekrutacja: string;
  prog: number | null;
  miejsca: number;
  pelnaPula: boolean;
}

type ForecastPilotKind = "dermatologia" | "ortodoncja";

interface ForecastPilotConfig {
  specialty: string;
  slug: string;
  title: React.ReactNode;
  documentTitle: string;
  defaultScore: number;
}

const FORECAST_PILOTS: Record<ForecastPilotKind, ForecastPilotConfig> = {
  dermatologia: {
    specialty: "Dermatologia i wenerologia",
    slug: "dermatologia-i-wenerologia",
    title: <>Dermatologia<br />i wenerologia</>,
    documentTitle: "Prognoza rekrutacyjna — dermatologia i wenerologia",
    defaultScore: 95,
  },
  ortodoncja: {
    specialty: "Ortodoncja",
    slug: "ortodoncja",
    title: <>Ortodoncja</>,
    documentTitle: "Prognoza rekrutacyjna — ortodoncja",
    defaultScore: 90,
  },
};

function parseForecast(specialty: string): ForecastRow[] {
  const [headerLine, ...lines] = forecastCsv.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  const index = (name: string) => headers.indexOf(name);

  return lines
    .map((line) => line.split(","))
    .filter((cells) => cells[index("dziedzina_medycyny")] === specialty)
    .map((cells) => ({
      wojewodztwo: cells[index("wojewodztwo")],
      liczbaMiejsc: Number(cells[index("liczba_miejsc")]),
      pewnosc: cells[index("poziom_pewnosci")] as ForecastRow["pewnosc"],
      prawdopodobienstwoPelnejPuli: Number(cells[index("prawdopodobienstwo_pelnej_puli")]),
      historycznePelnePule: Number(cells[index("historyczne_pelne_pule")]),
      grupaPilotazowa: cells[index("grupa_pilotazowa")],
      prognoza: Number(cells[index("prognoza_modelowa")]),
      dolnaGranica: Number(cells[index("dolna_granica_80_proc")]),
      gornaGranica: Number(cells[index("gorna_granica_80_proc")]),
    }))
    .sort((a, b) => a.prognoza - b.prognoza);
}

const recruitmentOrder = ["w-2023", "j-2023", "w-2024", "j-2024", "w-2025", "j-2025", "w-2026"];

function groupHistory(pools: RecruitmentPool[]) {
  const byRegion = new Map<string, HistoricalRow[]>();

  for (const pool of pools) {
    if (pool.tryb_szkolenia !== "Rezydencki" || !pool.liczba_miejsc || pool.liczba_miejsc <= 0) continue;
    const rows = byRegion.get(pool.wojewodztwo) ?? [];
    rows.push({
      rekrutacja: pool.rekrutacja,
      prog: pool.najnizszy_wynik_proc,
      miejsca: pool.liczba_miejsc,
      pelnaPula: pool.status_konkurencyjnosci === "full",
    });
    byRegion.set(pool.wojewodztwo, rows);
  }

  for (const rows of byRegion.values()) {
    rows.sort((a, b) => recruitmentOrder.indexOf(a.rekrutacja) - recruitmentOrder.indexOf(b.rekrutacja));
  }
  return byRegion;
}

function parseNationalForecast(specialty: string) {
  const [headerLine, ...lines] = nationalForecastCsv.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  const specialtyIndex = headers.indexOf("dziedzina_medycyny");
  const forecastIndex = headers.indexOf("prognoza_krajowa_proc");
  const row = lines.map((line) => line.split(",")).find((cells) => cells[specialtyIndex] === specialty);
  return row ? Number(row[forecastIndex]) : 0;
}

function scorePosition(score: number, row: ForecastRow) {
  if (score >= row.gornaGranica) return { label: "powyżej zakresu", tone: "good" };
  if (score >= row.prognoza) return { label: "powyżej prognozy", tone: "good" };
  if (score >= row.dolnaGranica) return { label: "w zakresie prognozy", tone: "close" };
  return { label: "poniżej zakresu", tone: "low" };
}

function formatUncertainty(row: ForecastRow) {
  const lower = row.prognoza - row.dolnaGranica;
  const upper = row.gornaGranica - row.prognoza;
  return Math.abs(lower - upper) < 0.15
    ? `±${((lower + upper) / 2).toFixed(1)} p.p.`
    : `−${lower.toFixed(1)}/+${upper.toFixed(1)} p.p.`;
}

function formatPlaceDelta(current: number, previous: number | undefined) {
  if (previous === undefined) return "brak porównania";
  const difference = current - previous;
  if (difference === 0) return "bez zmian";
  return `${difference > 0 ? "+" : ""}${difference} vs poprzedni nabór`;
}

function formatScoreMargin(value: number) {
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  const sign = normalized > 0 ? "+" : normalized < 0 ? "−" : "";
  return `${sign}${Math.abs(normalized).toFixed(1)} p.p. · ≈ ${(Math.abs(normalized) * 2.1).toFixed(1).replace(".", ",")} pkt rekrut.`;
}

function formatRecruitmentPoints(score: number) {
  return ((score / 100) * 210).toFixed(1).replace(".", ",");
}

function confidenceBasis(row: ForecastRow) {
  const smallPool = row.grupaPilotazowa === "B_wysoki_prog_mala_pula";
  return `${row.historycznePelnePule} pełnych pul${smallPool ? " · mała pula miejsc" : " w historii"}`;
}

function MiniHistoryChart({ values, forecast }: { values: number[]; forecast: number }) {
  const allValues = [...values, forecast];
  const min = Math.min(...allValues) - 0.5;
  const max = Math.max(...allValues) + 0.5;
  const span = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 10 : 5 + (index / (values.length - 1)) * 66;
    const y = 25 - ((value - min) / span) * 20;
    return `${x},${y}`;
  }).join(" ");
  const forecastY = 25 - ((forecast - min) / span) * 20;

  return (
    <svg className="history-sparkline" viewBox="0 0 92 30" role="img" aria-label="Historia progów i prognoza">
      {values.length > 1 && <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.7" />}
      {values.map((value, index) => {
        const x = values.length === 1 ? 10 : 5 + (index / (values.length - 1)) * 66;
        const y = 25 - ((value - min) / span) * 20;
        return <circle key={`${value}-${index}`} cx={x} cy={y} r="2" fill="currentColor" />;
      })}
      <line x1="76" y1="4" x2="76" y2="27" stroke="#c9d5ce" strokeDasharray="2 2" />
      <circle cx="86" cy={forecastY} r="3" fill="#176b4d" />
    </svg>
  );
}

export function SpecialtyForecastPilot({ kind }: { kind: ForecastPilotKind }) {
  const config = FORECAST_PILOTS[kind];
  const forecastRows = useMemo(() => parseForecast(config.specialty), [config.specialty]);
  const nationalForecast = useMemo(() => parseNationalForecast(config.specialty), [config.specialty]);
  const [score, setScore] = useState(config.defaultScore);
  const [historyByRegion, setHistoryByRegion] = useState<Map<string, HistoricalRow[]>>(new Map());

  useEffect(() => {
    const previousTitle = document.title;
    document.title = config.documentTitle;
    setHistoryByRegion(new Map());
    void fetchSpecialtyPools(config.specialty).then((pools) => setHistoryByRegion(groupHistory(pools)));
    return () => { document.title = previousTitle; };
  }, [config.documentTitle, config.specialty]);

  const totalPlaces = useMemo(() => forecastRows.reduce((sum, row) => sum + row.liczbaMiejsc, 0), [forecastRows]);
  const expectedFullPools = useMemo(
    () => forecastRows.reduce((sum, row) => sum + row.prawdopodobienstwoPelnejPuli, 0),
    [forecastRows],
  );
  const aboveForecast = useMemo(
    () => forecastRows.filter((row) => score >= row.prognoza).length,
    [forecastRows, score],
  );

  return (
    <main className="forecast-page">
      <nav className="forecast-nav" aria-label="Nawigacja">
        <a href="/" className="forecast-brand">progi<span>.specjalizacje</span></a>
        <a href={`/?specializacja=${config.slug}#raport`} className="forecast-back">
          <ArrowLeft size={17} /> Dane historyczne
        </a>
      </nav>

      <header className="forecast-hero">
        <div className="forecast-hero-copy">
          <div className="forecast-kicker"><Sparkles size={15} /> Pilotaż prognoz · jesień 2026</div>
          <h1>{config.title}</h1>
          <p>
            Sprawdź przewidywany próg rekrutacyjny w każdym województwie i zobacz,
            jak Twój wynik wypada na tle modelu.
          </p>
          <div className="forecast-caveat"><Info size={17} /> Prognoza wspiera decyzję — nie gwarantuje kwalifikacji.</div>
        </div>

        <section className="forecast-score-card" aria-labelledby="score-title">
          <div className="score-card-heading">
            <div>
              <span id="score-title">Twój wynik jako % punktów rekrutacyjnych</span>
              <strong>{score.toFixed(1)}%</strong>
              <small className="score-definition">Procent maksymalnej puli 210 pkt rekrutacyjnych</small>
            </div>
            <span className="score-equivalent">≈ {formatRecruitmentPoints(score)} / 210 pkt</span>
          </div>
          <input
            aria-label="Twój wynik jako procent maksymalnej puli 210 punktów rekrutacyjnych"
            type="range"
            min="85"
            max="100"
            step="0.1"
            value={score}
            onChange={(event) => setScore(Number(event.target.value))}
          />
          <div className="score-scale"><span>85%</span><span>100%</span></div>
          <div className="score-summary">
            <CheckCircle2 size={21} />
            <p>Twój wynik jest równy lub wyższy od centralnej prognozy w <strong>{aboveForecast} z {forecastRows.length}</strong> województw.</p>
          </div>
        </section>
      </header>

      <section className="forecast-stat-grid" aria-label="Najważniejsze liczby">
        <article><span>Prognoza krajowa</span><strong>{nationalForecast.toFixed(1)}%</strong><small>centralny szacunek modelu</small></article>
        <article><span>Miejsca rezydenckie</span><strong>{totalPlaces}</strong><small>w {forecastRows.length} województwach</small></article>
        <article><span>Spodziewane pełne pule</span><strong>{expectedFullPools.toFixed(1).replace(".", ",")} / {forecastRows.length}</strong><small>bardzo wysoka konkurencja</small></article>
      </section>

      <section className="forecast-results" aria-labelledby="regions-title">
        <div className="forecast-section-heading">
          <div>
            <span className="forecast-kicker"><MapPin size={15} /> Porównanie regionów</span>
            <h2 id="regions-title">Porównaj prognozy w województwach</h2>
          </div>
          <div className="forecast-legend"><i className="good" /> powyżej prognozy <i className="close" /> w przedziale <i className="low" /> poniżej</div>
        </div>

        <div className="forecast-table-wrap" tabIndex={0}>
          <table className="forecast-table">
            <thead><tr><th>Województwo i historia</th><th>Prognoza i niepewność <span className="table-help" title="Centralna prognoza oraz empiryczny przedział 80% błędu modelu">?</span></th><th>Miejsca</th><th>Twój wynik</th></tr></thead>
            <tbody>
              {forecastRows.map((row) => {
                const position = scorePosition(score, row);
                const history = historyByRegion.get(row.wojewodztwo) ?? [];
                const competitiveHistory = history.filter((item) => item.pelnaPula && item.prog !== null);
                const recentHistory = competitiveHistory.slice(-6);
                const latestThreshold = competitiveHistory[competitiveHistory.length - 1];
                const previousOffer = history[history.length - 1];
                const scoreMargin = score - row.prognoza;
                return (
                  <tr key={row.wojewodztwo}>
                    <th scope="row" className="region-history-cell">
                      <span>{row.wojewodztwo}</span>
                      <div className="region-history-meta">
                        <MiniHistoryChart values={recentHistory.map((item) => item.prog as number)} forecast={row.prognoza} />
                        <small>{latestThreshold ? `ostatni ${latestThreshold.prog?.toFixed(1)}% → prognoza ${(row.prognoza - (latestThreshold.prog as number)) >= 0 ? "+" : "−"}${Math.abs(row.prognoza - (latestThreshold.prog as number)).toFixed(1)} p.p.` : "brak konkurencyjnego progu"}</small>
                      </div>
                    </th>
                    <td className="forecast-detail-cell" data-label="Prognoza i niepewność">
                      <strong>{row.prognoza.toFixed(1)}% <span>{formatUncertainty(row)}</span></strong>
                      <small>szansa pełnej puli {(row.prawdopodobienstwoPelnejPuli * 100).toFixed(1)}% · {confidenceBasis(row)}</small>
                    </td>
                    <td className="places-cell" data-label="Miejsca">
                      <strong>{row.liczbaMiejsc}</strong>
                      <small>{formatPlaceDelta(row.liczbaMiejsc, previousOffer?.miejsca)}</small>
                    </td>
                    <td className="user-score-cell" data-label="Twój wynik">
                      <span className={`position position-${position.tone}`}>{position.label}</span>
                      <small>{formatScoreMargin(scoreMargin)}</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="forecast-explainer" id="metodologia">
        <div className="explainer-icon"><ShieldCheck size={25} /></div>
        <div><h2>Jak czytać tę prognozę?</h2><p><strong>Próg</strong> to centralny szacunek wyniku ostatniej zakwalifikowanej osoby. <strong>Przedział 80%</strong> pokazuje realistyczny zakres niepewności — im szerszy, tym ostrożniej interpretuj wynik.</p></div>
        <a href={`/?specializacja=${config.slug}#raport`}>Zobacz dane źródłowe <ArrowUpRight size={16} /></a>
      </section>

      <footer className="forecast-footer">
        <p>Model: pilotaż regionalny · dane dostępne przed naborem jesień 2026 · ostatnia aktualizacja 09.2026</p>
        <p>Wyniki mają charakter informacyjny. Wiążące są dane publikowane przez CMKP.</p>
      </footer>
    </main>
  );
}

export function DermatologyForecastPilot() {
  return <SpecialtyForecastPilot kind="dermatologia" />;
}

export function OrthodonticsForecastPilot() {
  return <SpecialtyForecastPilot kind="ortodoncja" />;
}

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, CheckCircle2, Info, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import forecastCsv from "../../prediction/data/threshold_forecast_j-2026.csv?raw";
import nationalForecastCsv from "../../prediction/data/national_threshold_forecast_j-2026.csv?raw";

interface ForecastRow {
  wojewodztwo: string;
  liczbaMiejsc: number;
  pewnosc: "wyzszy" | "sredni" | "niski";
  prawdopodobienstwoPelnejPuli: number;
  prognoza: number;
  dolnaGranica: number;
  gornaGranica: number;
}

const SPECIALTY = "Dermatologia i wenerologia";
function parseForecast(): ForecastRow[] {
  const [headerLine, ...lines] = forecastCsv.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  const index = (name: string) => headers.indexOf(name);

  return lines
    .map((line) => line.split(","))
    .filter((cells) => cells[index("dziedzina_medycyny")] === SPECIALTY)
    .map((cells) => ({
      wojewodztwo: cells[index("wojewodztwo")],
      liczbaMiejsc: Number(cells[index("liczba_miejsc")]),
      pewnosc: cells[index("poziom_pewnosci")] as ForecastRow["pewnosc"],
      prawdopodobienstwoPelnejPuli: Number(cells[index("prawdopodobienstwo_pelnej_puli")]),
      prognoza: Number(cells[index("prognoza_modelowa")]),
      dolnaGranica: Number(cells[index("dolna_granica_80_proc")]),
      gornaGranica: Number(cells[index("gorna_granica_80_proc")]),
    }))
    .sort((a, b) => a.prognoza - b.prognoza);
}

const forecastRows = parseForecast();

function parseNationalForecast() {
  const [headerLine, ...lines] = nationalForecastCsv.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  const specialtyIndex = headers.indexOf("dziedzina_medycyny");
  const forecastIndex = headers.indexOf("prognoza_krajowa_proc");
  const row = lines.map((line) => line.split(",")).find((cells) => cells[specialtyIndex] === SPECIALTY);
  return row ? Number(row[forecastIndex]) : 0;
}

const nationalForecast = parseNationalForecast();

function scorePosition(score: number, row: ForecastRow) {
  if (score >= row.gornaGranica) return { label: "powyżej zakresu", tone: "good" };
  if (score >= row.prognoza) return { label: "powyżej prognozy", tone: "good" };
  if (score >= row.dolnaGranica) return { label: "w zakresie prognozy", tone: "close" };
  return { label: "poniżej zakresu", tone: "low" };
}

function confidenceLabel(value: ForecastRow["pewnosc"]) {
  if (value === "wyzszy") return "wyższa";
  if (value === "sredni") return "średnia";
  return "niska";
}

export function DermatologyForecastPilot() {
  const [score, setScore] = useState(95);
  const totalPlaces = useMemo(() => forecastRows.reduce((sum, row) => sum + row.liczbaMiejsc, 0), []);
  const expectedFullPools = useMemo(
    () => forecastRows.reduce((sum, row) => sum + row.prawdopodobienstwoPelnejPuli, 0),
    [],
  );
  const aboveForecast = useMemo(
    () => forecastRows.filter((row) => score >= row.prognoza).length,
    [score],
  );

  return (
    <main className="forecast-page">
      <nav className="forecast-nav" aria-label="Nawigacja">
        <a href="/" className="forecast-brand">progi<span>.specjalizacje</span></a>
        <a href="/?specializacja=dermatologia-i-wenerologia#raport" className="forecast-back">
          <ArrowLeft size={17} /> Dane historyczne
        </a>
      </nav>

      <header className="forecast-hero">
        <div className="forecast-hero-copy">
          <div className="forecast-kicker"><Sparkles size={15} /> Pilotaż prognoz · jesień 2026</div>
          <h1>Dermatologia<br />i wenerologia</h1>
          <p>
            Sprawdź przewidywany próg rekrutacyjny w każdym województwie i zobacz,
            jak Twój wynik wypada na tle modelu.
          </p>
          <div className="forecast-caveat"><Info size={17} /> Prognoza wspiera decyzję — nie gwarantuje kwalifikacji.</div>
        </div>

        <section className="forecast-score-card" aria-labelledby="score-title">
          <div className="score-card-heading">
            <div>
              <span id="score-title">Twój wynik</span>
              <strong>{score.toFixed(1)}%</strong>
            </div>
            <span className="score-equivalent">≈ {Math.round(score * 2)} pkt LEK</span>
          </div>
          <input
            aria-label="Twój wynik procentowy"
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
        <article><span>Miejsca rezydenckie</span><strong>{totalPlaces}</strong><small>w 11 województwach</small></article>
        <article><span>Spodziewane pełne pule</span><strong>{expectedFullPools.toFixed(1).replace(".", ",")} / {forecastRows.length}</strong><small>bardzo wysoka konkurencja</small></article>
      </section>

      <section className="forecast-results" aria-labelledby="regions-title">
        <div className="forecast-section-heading">
          <div>
            <span className="forecast-kicker"><MapPin size={15} /> Porównanie regionów</span>
            <h2 id="regions-title">Gdzie Twój wynik daje największy margines?</h2>
          </div>
          <div className="forecast-legend"><i className="good" /> powyżej prognozy <i className="close" /> w przedziale <i className="low" /> poniżej</div>
        </div>

        <div className="forecast-table-wrap" tabIndex={0}>
          <table className="forecast-table">
            <thead><tr><th>Województwo</th><th>Prognozowany próg</th><th>Przedział 80% i margines</th><th>Miejsca</th><th>Pewność</th><th>Twój wynik</th></tr></thead>
            <tbody>
              {forecastRows.map((row) => {
                const position = scorePosition(score, row);
                return (
                  <tr key={row.wojewodztwo}>
                    <th scope="row">{row.wojewodztwo}</th>
                    <td className="threshold-cell"><strong>{row.prognoza.toFixed(1)}%</strong><span style={{ width: `${Math.max(6, (row.prognoza - 88) * 7)}%` }} /></td>
                    <td className="interval-cell">
                      <strong>{row.dolnaGranica.toFixed(1)}–{row.gornaGranica.toFixed(1)}%</strong>
                      <small>
                        −{(row.prognoza - row.dolnaGranica).toFixed(1)} / +{(row.gornaGranica - row.prognoza).toFixed(1)} p.p.
                      </small>
                    </td>
                    <td>{row.liczbaMiejsc}</td>
                    <td><span className={`confidence confidence-${row.pewnosc}`}>{confidenceLabel(row.pewnosc)}</span></td>
                    <td><span className={`position position-${position.tone}`}>{position.label}</span></td>
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
        <a href="/?specializacja=dermatologia-i-wenerologia#raport">Zobacz dane źródłowe <ArrowUpRight size={16} /></a>
      </section>

      <footer className="forecast-footer">
        <p>Model: pilotaż regionalny · dane dostępne przed naborem jesień 2026 · ostatnia aktualizacja 09.2026</p>
        <p>Wyniki mają charakter informacyjny. Wiążące są dane publikowane przez CMKP.</p>
      </footer>
    </main>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  fetchSpecialtyPlaces,
  fetchSpecialtyPools,
  fetchThresholdForecast,
  getReportOptions,
} from "../data/reportData";
import type { OfferedPlaces, RecruitmentPool, ThresholdForecast } from "../types";
import { formatByType, formatNumber, formatRecruitmentName } from "../utils/formatters";
import { average, median, toDisplayedScore } from "../utils/reportMetrics";
import { ForecastIntro } from "../components/ForecastCard";

const AXIS_FROM_PROC = 50;
const LOW_FILL_CHANCE = 0.5;
const REGIONS = [
  "Dolnośląskie",
  "Kujawsko-pomorskie",
  "Lubelskie",
  "Lubuskie",
  "Łódzkie",
  "Małopolskie",
  "Mazowieckie",
  "Opolskie",
  "Podkarpackie",
  "Podlaskie",
  "Pomorskie",
  "Śląskie",
  "Świętokrzyskie",
  "Warmińsko-mazurskie",
  "Wielkopolskie",
  "Zachodniopomorskie",
];

/** Ten sam sezon rok wcześniej: j-2026 -> j-2025. */
function sameSeasonLastYear(rekrutacja: string) {
  const match = /^([wj])-(\d{4})$/.exec(rekrutacja);
  return match ? `${match[1]}-${Number(match[2]) - 1}` : null;
}

type ReasonKind = "forecast" | "no-places" | "no-history" | "never-full" | "out-of-scope";

interface HistoryCell {
  rekrutacja: string;
  kind: "full" | "underfilled" | "empty" | "none";
  places: number | null;
  qualified: number | null;
  score: number | null;
}

function historyCell(rekrutacja: string, pool: RecruitmentPool | undefined, places: OfferedPlaces | undefined): HistoryCell {
  if (!pool) {
    return {
      rekrutacja,
      kind: "none",
      places: places?.liczba_miejsc ?? null,
      qualified: null,
      score: null,
    };
  }
  const kind =
    pool.status_konkurencyjnosci === "full"
      ? "full"
      : pool.liczba_zakwalifikowanych === 0
        ? "empty"
        : "underfilled";
  return {
    rekrutacja,
    kind,
    places: pool.liczba_miejsc,
    qualified: pool.liczba_zakwalifikowanych,
    score: pool.najnizszy_wynik_proc,
  };
}

export function ForecastDraft() {
  const [forecast, setForecast] = useState<ThresholdForecast[]>([]);
  const [specialty, setSpecialty] = useState("");
  const [pools, setPools] = useState<RecruitmentPool[]>([]);
  const [places, setPlaces] = useState<OfferedPlaces[]>([]);
  const [asPoints, setAsPoints] = useState(false);

  useEffect(() => {
    void fetchThresholdForecast().then((rows) => {
      setForecast(rows);
      const first = [...new Set(rows.map((row) => row.dziedzina_medycyny))].sort((a, b) => a.localeCompare(b, "pl"))[0];
      setSpecialty((current) => current || first || "");
    });
  }, []);

  useEffect(() => {
    if (!specialty) return;
    let cancelled = false;
    void Promise.all([fetchSpecialtyPools(specialty), fetchSpecialtyPlaces(specialty)]).then(([poolRows, placeRows]) => {
      if (cancelled) return;
      setPools(poolRows);
      setPlaces(placeRows);
    });
    return () => {
      cancelled = true;
    };
  }, [specialty]);

  const specialties = useMemo(
    () => [...new Set(forecast.map((row) => row.dziedzina_medycyny))].sort((a, b) => a.localeCompare(b, "pl")),
    [forecast],
  );

  const model = useMemo(() => {
    const options = getReportOptions();
    const upcomingRounds = new Set(options.zapowiedzianeRekrutacje);
    const forecastRows = forecast.filter((row) => row.dziedzina_medycyny === specialty && upcomingRounds.has(row.rekrutacja));
    const rekrutacja = forecastRows[0]?.rekrutacja ?? options.zapowiedzianeRekrutacje[0] ?? null;
    const comparison = rekrutacja ? sameSeasonLastYear(rekrutacja) : null;
    const rounds = [...options.rekrutacje].reverse();

    const residential = <T extends { tryb_szkolenia: string }>(rows: T[]) =>
      rows.filter((row) => row.tryb_szkolenia === "Rezydencki");
    const residentialPools = residential(pools);
    const residentialPlaces = residential(places);

    const forecastByRegion = new Map(forecastRows.map((row) => [row.wojewodztwo, row]));

    const regions = REGIONS.map((wojewodztwo) => {
      const history = rounds.map((round) =>
        historyCell(
          round,
          residentialPools.find((pool) => pool.rekrutacja === round && pool.wojewodztwo === wojewodztwo),
          residentialPlaces.find((place) => place.rekrutacja === round && place.wojewodztwo === wojewodztwo),
        ),
      );
      const upcomingPlaces =
        residentialPlaces.find((place) => place.rekrutacja === rekrutacja && place.wojewodztwo === wojewodztwo)
          ?.liczba_miejsc ?? 0;
      const offered = history.filter((cell) => cell.places !== null && cell.places > 0 && cell.kind !== "none");
      const fullCount = history.filter((cell) => cell.kind === "full").length;
      const row = forecastByRegion.get(wojewodztwo);

      let reason: ReasonKind;
      let detail: string;
      if (row) {
        reason = "forecast";
        detail = "";
      } else if (upcomingPlaces <= 0) {
        reason = "no-places";
        detail = `W ${rekrutacja ? formatRecruitmentName(rekrutacja) : "tej rekrutacji"} nie ma tu miejsc rezydenckich w tej specjalizacji.`;
      } else if (offered.length === 0) {
        reason = "no-history";
        detail = `Są ${upcomingPlaces} ${upcomingPlaces === 1 ? "miejsce" : "miejsc"}, ale w poprzednich rundach nie było tu oferty ani wyników, więc nie ma na czym oprzeć prognozy.`;
      } else if (fullCount === 0) {
        const placesSum = offered.reduce((total, cell) => total + (cell.places ?? 0), 0);
        const qualifiedSum = offered.reduce((total, cell) => total + (cell.qualified ?? 0), 0);
        reason = "never-full";
        detail = `Oferta była w ${offered.length} z ${rounds.length} rund, ale pula ani razu nie została w pełni obsadzona (zakwalifikowanych łącznie ${qualifiedSum} na ${placesSum} miejsc), więc nie powstał próg konkurencyjny, którego dotyczy model.`;
      } else {
        reason = "out-of-scope";
        detail = `Pula miała już pełną obsadę (${fullCount}×), ale prognozy dla niej nie ma: model nie objął tej pary w eksporcie.`;
      }
      return { wojewodztwo, row, upcomingPlaces, history, reason, detail, fullCount };
    });

    const withForecast = regions
      .filter((region) => region.row)
      .map((region) => ({
        ...region,
        prognoza: toDisplayedScore(region.row?.prognoza_proc ?? null, "Rezydencki", asPoints),
        dolna: toDisplayedScore(region.row?.dolna_proc ?? null, "Rezydencki", asPoints),
        gorna: toDisplayedScore(region.row?.gorna_proc ?? null, "Rezydencki", asPoints),
      }))
      .sort((a, b) => b.prognoza - a.prognoza);
    const order: ReasonKind[] = ["never-full", "no-history", "no-places", "out-of-scope"];
    const withoutForecast = regions
      .filter((region) => !region.row)
      .sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason) || a.wojewodztwo.localeCompare(b.wojewodztwo, "pl"));

    const comparisonPools = residentialPools.filter(
      (pool) =>
        pool.rekrutacja === comparison && pool.status_konkurencyjnosci === "full" && pool.najnizszy_wynik_proc !== null,
    );
    const nationalProc = average(comparisonPools.map((pool) => pool.najnizszy_wynik_proc as number));

    return {
      rekrutacja,
      comparison,
      rounds,
      withForecast,
      withoutForecast,
      nationalMean: toDisplayedScore(nationalProc, "Rezydencki", asPoints),
      nationalPools: comparisonPools.length,
    };
  }, [forecast, pools, places, specialty, asPoints]);

  const format = (value: number) => formatByType(value, "score", asPoints);
  const axisFrom = asPoints ? Math.round((AXIS_FROM_PROC / 100) * 210) : AXIS_FROM_PROC;
  const axisTo = asPoints ? 210 : 100;
  const position = (value: number) => `${Math.min(100, Math.max(0, ((value - axisFrom) / (axisTo - axisFrom)) * 100))}%`;
  const hasNational = Number.isFinite(model.nationalMean);
  const competitive = model.withForecast.filter((row) => (row.row?.prawdopodobienstwo_pelnej_puli ?? 0) >= LOW_FILL_CHANCE);
  const medianForecast = competitive.length > 0 ? median(competitive.map((row) => row.prognoza)) : Number.NaN;
  const totalUpcomingPlaces = [...model.withForecast, ...model.withoutForecast].reduce(
    (total, region) => total + region.upcomingPlaces,
    0,
  );
  const placesWithoutForecast = model.withoutForecast.reduce((total, region) => total + region.upcomingPlaces, 0);
  const diffText = (value: number) => `${value >= 0 ? "+" : "−"}${formatNumber(Math.abs(value), 1)}`;

  const historyChip = (cell: HistoryCell) => {
    const title =
      cell.kind === "none"
        ? `${formatRecruitmentName(cell.rekrutacja)}: brak oferty lub wyników`
        : `${formatRecruitmentName(cell.rekrutacja)}: ${cell.qualified} zakwalifikowanych na ${cell.places ?? "?"} miejsc` +
          (cell.kind === "full" && cell.score !== null ? `, próg ${formatByType(cell.score, "score")}` : "");
    const label =
      cell.kind === "full" && cell.score !== null
        ? formatNumber(asPoints ? toDisplayedScore(cell.score, "Rezydencki", true) : cell.score, asPoints ? 0 : 1)
        : cell.kind === "none"
          ? "–"
          : `${cell.qualified}/${cell.places ?? "?"}`;
    return (
      <span key={cell.rekrutacja} className={`draft-chip draft-chip-${cell.kind}`} title={title}>
        {label}
      </span>
    );
  };

  return (
    <main className="draft-page">
      <section className="draft-intro">
        <ForecastIntro />
      </section>
      <header className="draft-header">
        <h1>Szkic: prognoza progów</h1>
        <div className="draft-controls">
          <label>
            Specjalizacja
            <select value={specialty} onChange={(event) => setSpecialty(event.target.value)}>
              {specialties.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="draft-check">
            <input type="checkbox" checked={asPoints} onChange={(event) => setAsPoints(event.target.checked)} />
            punkty zamiast procentów
          </label>
        </div>
      </header>

      {!model.rekrutacja ? (
        <section className="kpi-card draft-card">
          <p className="results-note">Brak zapowiedzianej rekrutacji.</p>
        </section>
      ) : (
        <section className="kpi-card draft-card">
          <div className="kpi-label">Prognoza progów · {formatRecruitmentName(model.rekrutacja)}</div>

          <div className="draft-summary">
            <div>
              <strong>{Number.isFinite(medianForecast) ? format(medianForecast) : "-"}</strong>
              <span>
                {competitive.length > 0
                  ? "mediana prognoz (pule z szansą ≥ 50%)"
                  : "brak pul z szansą pełnej obsady ≥ 50%"}
              </span>
            </div>
            <div>
              <strong>{hasNational ? format(model.nationalMean) : "-"}</strong>
              <span>
                średnia krajowa · {model.comparison ? formatRecruitmentName(model.comparison) : "-"}
                {hasNational && ` (${model.nationalPools} ${model.nationalPools === 1 ? "pula" : "pul"})`}
              </span>
            </div>
            <div>
              <strong>{Number.isFinite(medianForecast) && hasNational ? diffText(medianForecast - model.nationalMean) : "-"}</strong>
              <span>{asPoints ? "pkt" : "pkt proc."} różnicy</span>
            </div>
            <div>
              <strong>
                {model.withForecast.length}/{REGIONS.length}
              </strong>
              <span>
                województw z prognozą · {formatNumber(placesWithoutForecast)} z {formatNumber(totalUpcomingPlaces)} miejsc bez prognozy
              </span>
            </div>
          </div>

          <div className="draft-table-wrap">
            <table className="forecast-table draft-table">
              <thead>
                <tr>
                  <th scope="col">Województwo</th>
                  <th scope="col" className="num">
                    Miejsca
                  </th>
                  <th scope="col" className="num">
                    Szansa wypełnienia
                  </th>
                  <th scope="col" className="num">
                    Prognoza
                  </th>
                  <th scope="col" className="draft-axis">
                    Zakres prognozy
                  </th>
                  <th scope="col" className="num">
                    − średnia
                  </th>
                  <th scope="col">
                    <span className="draft-history-head">
                      {model.rounds.map((round) => (
                        <span key={round}>{round}</span>
                      ))}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {model.withForecast.map((region) => {
                  const row = region.row as ThresholdForecast;
                  const risky = (row.prawdopodobienstwo_pelnej_puli ?? 0) < LOW_FILL_CHANCE;
                  const diff = hasNational ? region.prognoza - model.nationalMean : Number.NaN;
                  const past = region.history.filter((cell) => cell.kind === "full" && cell.score !== null);
                  const pastScores = past.map((cell) => toDisplayedScore(cell.score, "Rezydencki", asPoints));
                  const pastTitle = past.length
                    ? `Dotychczasowe progi (pula pełna w ${past.length} z ${region.history.length} rund): ` +
                      past.map((cell) => `${cell.rekrutacja} ${format(toDisplayedScore(cell.score, "Rezydencki", asPoints))}`).join(", ")
                    : "";
                  return (
                    <tr key={region.wojewodztwo} className={risky ? "forecast-risky" : undefined}>
                      <th scope="row">{region.wojewodztwo}</th>
                      <td className="num">{formatNumber(region.upcomingPlaces)}</td>
                      <td className="num">{formatNumber((row.prawdopodobienstwo_pelnej_puli ?? 0) * 100)}%</td>
                      <td className="num">
                        <strong>{format(region.prognoza)}</strong>
                      </td>
                      <td className="draft-axis">
                        <div
                          className="forecast-range"
                          role="img"
                          aria-label={`Zakres od ${format(region.dolna)} do ${format(region.gorna)}`}
                        >
                          <span
                            className="forecast-range-bar"
                            style={{ left: position(region.dolna), right: `calc(100% - ${position(region.gorna)})` }}
                          />
                          {hasNational && <span className="draft-national-tick" style={{ left: position(model.nationalMean) }} />}
                          {pastScores.map((score, index) => (
                            <span key={index} className="draft-past-dot" style={{ left: position(score) }} title={pastTitle} />
                          ))}
                          <span className="forecast-range-dot" style={{ left: position(region.prognoza) }} />
                        </div>
                        <span className="forecast-range-label" title={pastTitle || undefined}>
                          najpewniej <b>{format(region.dolna)} – {format(region.gorna)}</b>
                          {pastScores.length > 0 && (
                            <>
                              {" "}
                              · bywało {format(Math.min(...pastScores))} – {format(Math.max(...pastScores))}
                            </>
                          )}
                        </span>
                      </td>
                      <td className="num">{Number.isFinite(diff) ? diffText(diff) : "-"}</td>
                      <td>
                        <span className="draft-history">{region.history.map(historyChip)}</span>
                      </td>
                    </tr>
                  );
                })}
                {model.withoutForecast.map((region) => (
                  <tr key={region.wojewodztwo} className={`draft-noforecast draft-reason-${region.reason}`}>
                    <th scope="row">{region.wojewodztwo}</th>
                    <td className="num">{formatNumber(region.upcomingPlaces)}</td>
                    <td colSpan={4}>
                      <span className="draft-reason-tag">
                        {region.reason === "no-places" && "brak miejsc"}
                        {region.reason === "no-history" && "brak historii"}
                        {region.reason === "never-full" && "pula nigdy nie była pełna"}
                        {region.reason === "out-of-scope" && "poza zakresem modelu"}
                      </span>
                      {region.detail}
                    </td>
                    <td>
                      <span className="draft-history">{region.history.map(historyChip)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="draft-legend">
            <span className="draft-chip draft-chip-full">83,6</span> pula pełna: próg konkurencyjny
            <span className="draft-chip draft-chip-underfilled">3/5</span> niepełna: zakwalifikowani / miejsca
            <span className="draft-chip draft-chip-empty">0/4</span> nikt się nie zakwalifikował
            <span className="draft-chip draft-chip-none">–</span> brak oferty lub wyników
          </div>
          <p className="results-note">
            <b>Jak czytać pewność prognozy:</b> im węższy zakres „najpewniej” i im bliżej prognozy leżą szare kropki
            (dotychczasowe progi tej puli), tym pewniejsza prognoza progu. „Szansa wypełnienia” to osobna sprawa: mówi,
            czy próg w ogóle powstanie, a nie jak dokładnie go przewidujemy.
          </p>
          <p className="results-note">
            Oś od {format(axisFrom)} do {format(axisTo)}. Fioletowy punkt: prognoza, szare kropki: dotychczasowe progi pełnych pul, pomarańczowa kreska: średnia progów
            konkurencyjnych w kraju z {model.comparison ? formatRecruitmentName(model.comparison) : "poprzedniego roku"} (średnia
            nieważona po województwach z pełną pulą). Wyszarzone: szansa wypełnienia poniżej {LOW_FILL_CHANCE * 100}%. Prognozę
            pokazujemy tylko dla pul, które kiedykolwiek miały pełną obsadę; pozostałych model nie umie wiarygodnie ocenić.
          </p>
        </section>
      )}
    </main>
  );
}

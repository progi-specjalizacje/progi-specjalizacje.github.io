import { useEffect, useMemo, useState } from "react";
import { isDentalSpecialty } from "../config/specialtySearchFilter";
import { fetchThresholdForecast, getReportOptions } from "../data/reportData";
import { useFilterStore } from "../state/filterStore";
import type { ThresholdForecast } from "../types";
import { formatByType, formatNumber, formatRecruitmentName, pluralize } from "../utils/formatters";
import { median, toDisplayedScore } from "../utils/reportMetrics";
import { trackEvent } from "../utils/analytics";
import { NEWSLETTER_URL } from "../config/newsletter";
import { InfoTooltip } from "./FilterControls";

// Poniżej tej szansy pełnej obsady prognozowany próg może w ogóle nie powstać (pula zostanie niepełna).
const LOW_FILL_CHANCE = 0.5;
const AXIS_FROM_PROC = 50;

export function ForecastIntro() {
  return (
    <section className="forecast-intro" aria-labelledby="forecast-intro-title">
      <h2 id="forecast-intro-title">Jak przewidzieć przyszłe progi? To niełatwe.</h2>
      <p>
        Na próg wpływa wiele zmiennych: liczba miejsc, specjalizacja, rozkład miejsc po województwach, wyniki
        egzaminu, historia zapełniania pul i wyniki osób zakwalifikowanych w poprzednich rekrutacjach.
      </p>
      <p>Najprostsze metody zawodzą:</p>
      <ul>
        <li>
          jeśli założysz, że próg będzie taki sam jak w ostatniej rekrutacji, pomylisz się średnio o{" "}
          <strong>3,8 pkt proc.</strong>,
        </li>
        <li>
          jeśli użyjesz średniego progu danej specjalizacji w całym kraju z ostatniej rekrutacji, pomylisz się średnio
          o <strong>3,7 pkt proc.</strong>,
        </li>
        <li>
          jeśli oprzesz się na progu z tej samej pory roku sprzed roku, pomylisz się średnio o{" "}
          <strong>3,0 pkt proc.</strong>
        </li>
      </ul>
      <p>
        Jest lepsze podejście. Nasz model uwzględnia m.in. historię progów w województwie i w kraju, sezonowość
        (wiosna i jesień), liczbę oferowanych miejsc i jej zmiany, historyczne zapełnienie pul oraz wyniki egzaminu.
        Dzięki temu <strong>zmniejszyliśmy średni błąd prognozy progu dla województwa o ok. 27%</strong>, do{" "}
        <strong>2,7 pkt proc.</strong>
      </p>
      <p>
        Nadal nie jest to satysfakcjonujące. W rekrutacji 2,7 pkt proc. to bardzo dużo: tak szeroki margines może
        decydować o tym, czy ktoś się dostanie, czy nie. Obecnie nie ma jednak lepszej alternatywy. Traktuj prognozę
        orientacyjnie, zwłaszcza dla specjalizacji, w których pule często zostają niepełne.
      </p>
      <p className="forecast-cta">
        <strong>Chcesz poznać nasze wyliczenia? Zapisz się do newslettera.</strong>
        {NEWSLETTER_URL && (
          <a
            className="forecast-cta-button"
            href={NEWSLETTER_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("newsletter-click", { source: "forecast" })}
          >
            Zapisz się
          </a>
        )}
      </p>
      <p className="forecast-footnote">
        Błędy średnie (MAE) z testu wstecznego: każda runda prognozowana wyłącznie na danych z rund wcześniejszych,
        952 progi wojewódzkie w pulach konkurencyjnych z rund jesień 2024 – wiosna 2026. Porównanie z progiem sprzed
        roku obejmuje 545 z nich (tylko tam taki próg istniał). Wynik dotyczy pul, które miały historię pełnych
        obsad, i został policzony dla specjalizacji lekarskich. Prognozy pokazujemy tylko dla takich pul; dla
        pozostałych (nigdy dotąd w pełni obsadzonych) oraz dla specjalizacji stomatologicznych prognozy nie ma.
        Zakresy poszerzamy tam, gdzie warianty modelu się rozjeżdżają albo historia puli jest zmienna.
      </p>
    </section>
  );
}

export function ForecastCard() {
  const dziedzina = useFilterStore((state) => state.filters.dziedzinaMedycyny);
  const trybSzkolenia = useFilterStore((state) => state.filters.trybSzkolenia);
  const przedstawWynikJako = useFilterStore((state) => state.filters.przedstawWynikJako);
  const scoreAsPoints = przedstawWynikJako === "surowa ilość punktów rekrutacyjnych (poglądowo)";
  const [forecast, setForecast] = useState<ThresholdForecast[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchThresholdForecast().then((rows) => {
      if (!cancelled) setForecast(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const model = useMemo(() => {
    const upcoming = new Set(getReportOptions().zapowiedzianeRekrutacje);
    const rows = forecast
      .filter((row) => row.dziedzina_medycyny === dziedzina && upcoming.has(row.rekrutacja))
      .map((row) => ({
        ...row,
        prognoza: toDisplayedScore(row.prognoza_proc, "Rezydencki", scoreAsPoints),
        dolna: toDisplayedScore(row.dolna_proc, "Rezydencki", scoreAsPoints),
        gorna: toDisplayedScore(row.gorna_proc, "Rezydencki", scoreAsPoints),
      }))
      .filter((row) => Number.isFinite(row.prognoza))
      .sort((a, b) => b.prognoza - a.prognoza);
    return { rekrutacja: rows[0]?.rekrutacja ?? null, rows };
  }, [dziedzina, forecast, scoreAsPoints]);

  const format = (value: number) => formatByType(value, "score", scoreAsPoints);
  const axisFrom = scoreAsPoints ? Math.round((AXIS_FROM_PROC / 100) * 210) : AXIS_FROM_PROC;
  const axisTo = scoreAsPoints ? 210 : 100;
  const position = (value: number) =>
    `${Math.min(100, Math.max(0, ((value - axisFrom) / (axisTo - axisFrom)) * 100))}%`;

  if (trybSzkolenia !== "Rezydencki") {
    return (
      <section className="kpi-card forecast-card">
        <div className="kpi-label">Prognoza progów</div>
        <p className="results-note">Prognoza obejmuje wyłącznie tryb rezydencki. Przełącz tryb w pasku u góry.</p>
      </section>
    );
  }

  if (!model.rekrutacja) {
    return (
      <section className="kpi-card forecast-card">
        <div className="kpi-label">Prognoza progów</div>
        <p className="results-note">
          {isDentalSpecialty(dziedzina)
            ? "Prognozy dla specjalizacji stomatologicznych nie publikujemy: model wymaga jeszcze sprawdzenia dla egzaminu LDEK."
            : "Brak prognozy dla tej specjalizacji: w żadnym województwie pula nie była dotąd w pełni obsadzona, więc nie mamy podstaw do oszacowania progu konkurencyjnego."}
        </p>
      </section>
    );
  }

  const competitive = model.rows.filter((row) => (row.prawdopodobienstwo_pelnej_puli ?? 0) >= LOW_FILL_CHANCE);
  const medianForecast = median(competitive.map((row) => row.prognoza));

  return (
    <section
      className="kpi-card forecast-card"
      aria-label={`Prognoza progów · ${formatRecruitmentName(model.rekrutacja)}`}
    >
      <div className="kpi-label">
        Prognoza progów · {formatRecruitmentName(model.rekrutacja)}
        <InfoTooltip text="Prognoza modelu na podstawie danych sprzed rekrutacji. Zakres jest orientacyjny: tam, gdzie historia puli jest zmienna, jest szerszy. Próg konkurencyjny powstaje tylko wtedy, gdy pula zostanie w pełni obsadzona." />
      </div>

      <div className="results-headline">
        {competitive.length > 0 ? (
          <>
            <strong>{format(medianForecast)}</strong>
            <span>mediana prognozowanych progów</span>
          </>
        ) : (
          <span>
            W żadnym województwie pula nie powinna się w pełni zapełnić, więc progu konkurencyjnego może nie być.
          </span>
        )}
      </div>
      <p className="results-note">
        Średni błąd prognozy w teście wstecznym: ok. <b>2,7 pkt proc.</b> Dla specjalizacji z krótką historią bywa
        większy.
      </p>

      <div className="forecast-table-wrap">
        <table className="forecast-table">
          <thead>
            <tr>
              <th scope="col">Województwo</th>
              <th scope="col" className="num">
                Miejsca
              </th>
              <th scope="col" className="num">
                Prognoza
              </th>
              <th scope="col">
                Zakres
                <InfoTooltip text={`Oś od ${format(axisFrom)} do ${format(axisTo)}.`} />
              </th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => {
              const risky = (row.prawdopodobienstwo_pelnej_puli ?? 0) < LOW_FILL_CHANCE;
              return (
                <tr key={row.wojewodztwo} className={risky ? "forecast-risky" : undefined}>
                  <th scope="row">
                    {row.wojewodztwo}
                    {risky && (
                      <span className="forecast-flag">
                        pula może się nie zapełnić
                        <InfoTooltip
                          text={`Szansa pełnej obsady puli: ${formatNumber((row.prawdopodobienstwo_pelnej_puli ?? 0) * 100)}%. Gdy zostają wolne miejsca, próg konkurencyjny nie powstaje (przyjmowani są wszyscy chętni).`}
                        />
                      </span>
                    )}
                  </th>
                  <td className="num">{row.liczba_miejsc === null ? "-" : formatNumber(row.liczba_miejsc)}</td>
                  <td className="num">
                    <strong>{format(row.prognoza)}</strong>
                  </td>
                  <td>
                    <div
                      className="forecast-range"
                      role="img"
                      aria-label={`Zakres: od ${format(row.dolna)} do ${format(row.gorna)}`}
                    >
                      <span
                        className="forecast-range-bar"
                        style={{ left: position(row.dolna), right: `calc(100% - ${position(row.gorna)})` }}
                      />
                      <span className="forecast-range-dot" style={{ left: position(row.prognoza) }} />
                    </div>
                    <span className="forecast-range-label">
                      {format(row.dolna)} – {format(row.gorna)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="results-note">
        {model.rows.length} {pluralize(model.rows.length, ["województwo", "województwa", "województw"])} z ofertą.
      </p>
    </section>
  );
}

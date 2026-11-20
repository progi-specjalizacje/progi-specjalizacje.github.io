import { useMemo } from "react";
import { useFilteredPlaces } from "../hooks/useFilteredPlaces";
import { useFilteredPools } from "../hooks/useFilteredPools";
import { useFilterStore } from "../state/filterStore";
import type { RecruitmentPool } from "../types";
import { formatByType, formatNumber, formatRecruitmentName } from "../utils/formatters";
import { getRecruitmentTimeline, poolVacancies, sameSeasonPreviousYear, toDisplayedScore } from "../utils/reportMetrics";
import { InfoTooltip } from "./FilterControls";

interface RegionRow {
  wojewodztwo: string;
  /** Próg (wynik ostatniej osoby) tylko w puli, w której zajęto wszystkie miejsca. */
  score: number;
  /** Zmiana progu względem tego samego sezonu rok wcześniej; NaN, gdy któryś próg nie istnieje. */
  delta: number;
  places: number | null;
  vacancies: number | null;
}

/**
 * Karta zastępująca „Najbliższą rekrutację”, gdy żadna rekrutacja nie czeka na wyniki:
 * progi ostatniej rozstrzygniętej rekrutacji według województw i zmiana rok do roku.
 */
export function RegionResultsCard() {
  const pools = useFilteredPools();
  const places = useFilteredPlaces();
  const przedstawWynikJako = useFilterStore((state) => state.filters.przedstawWynikJako);
  const trybSzkolenia = useFilterStore((state) => state.filters.trybSzkolenia);
  const scoreAsPoints = przedstawWynikJako === "surowa ilość punktów rekrutacyjnych (poglądowo)";

  const model = useMemo(() => {
    const rekrutacja = getRecruitmentTimeline(pools, places).completed[0] ?? null;
    const comparison = rekrutacja ? sameSeasonPreviousYear(rekrutacja) : null;
    const thresholdOf = (pool: RecruitmentPool | undefined) =>
      pool && pool.status_konkurencyjnosci === "full"
        ? toDisplayedScore(pool.najnizszy_wynik_proc, trybSzkolenia, scoreAsPoints)
        : Number.NaN;
    const previousByRegion = new Map(
      pools.filter((pool) => pool.rekrutacja === comparison).map((pool) => [pool.wojewodztwo, pool]),
    );

    const rows: RegionRow[] = pools
      .filter((pool) => pool.rekrutacja === rekrutacja && (pool.liczba_miejsc ?? 0) > 0)
      .map((pool) => {
        const score = thresholdOf(pool);
        return {
          wojewodztwo: pool.wojewodztwo,
          score,
          delta: score - thresholdOf(previousByRegion.get(pool.wojewodztwo)),
          places: pool.liczba_miejsc,
          vacancies: poolVacancies(pool),
        };
      })
      // Najpierw województwa z progiem (od najwyższego), potem te z wolnymi miejscami.
      .sort(
        (a, b) =>
          Number(Number.isFinite(b.score)) - Number(Number.isFinite(a.score)) ||
          (Number.isFinite(a.score) ? b.score - a.score : 0) ||
          a.wojewodztwo.localeCompare(b.wojewodztwo, "pl"),
      );

    return { rekrutacja, comparison, rows, comparedCount: rows.filter((row) => Number.isFinite(row.delta)).length };
  }, [places, pools, scoreAsPoints, trybSzkolenia]);

  const label = `Progi według województw · ${model.rekrutacja ? formatRecruitmentName(model.rekrutacja) : "-"}`;
  const formatDelta = (value: number) => {
    const rounded = Number(value.toFixed(scoreAsPoints ? 0 : 1));
    if (rounded === 0) return "bez zmian";
    return `${rounded > 0 ? "+" : "−"}${formatNumber(Math.abs(rounded), scoreAsPoints ? 0 : 1)}${scoreAsPoints ? " pkt" : " pp"}`;
  };

  return (
    <section className="kpi-card kpi-card-places kpi-card-latest" aria-label={label}>
      <div className="kpi-label">
        {label}
        <InfoTooltip text="Próg to wynik ostatniej zakwalifikowanej osoby w województwie, w którym zajęto wszystkie miejsca. Tam, gdzie zostały wolne miejsca, progu nie było - pokazujemy liczbę wolnych miejsc." />
      </div>
      {model.rows.length === 0 ? (
        <p className="results-note">Brak miejsc w tej rekrutacji dla wybranej specjalizacji i trybu.</p>
      ) : (
        <>
          <div className="kpi-context">
            {model.comparison && model.comparedCount > 0
              ? `od najwyższego progu · zmiana vs ${formatRecruitmentName(model.comparison)}`
              : "od najwyższego progu"}
          </div>
          <ul className="kpi-region-list kpi-region-results" aria-label="Progi według województw">
            {model.rows.map((row) => (
              <li key={row.wojewodztwo}>
                <span>{row.wojewodztwo}</span>
                {Number.isFinite(row.score) ? (
                  <span className="region-result">
                    <strong>{formatByType(row.score, "score", scoreAsPoints)}</strong>
                    {Number.isFinite(row.delta) && <small className="region-delta">{formatDelta(row.delta)}</small>}
                  </span>
                ) : (
                  <span className="region-result region-result-open">
                    {row.vacancies && row.places
                      ? `wolne ${formatNumber(row.vacancies)}/${formatNumber(row.places)}`
                      : "brak danych"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

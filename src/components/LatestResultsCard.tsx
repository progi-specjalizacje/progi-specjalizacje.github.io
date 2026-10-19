import { useMemo } from "react";
import { useFilteredPlaces } from "../hooks/useFilteredPlaces";
import { useFilteredPools } from "../hooks/useFilteredPools";
import { useFilterStore } from "../state/filterStore";
import { formatByType, formatNumber, formatRecruitmentName, pluralize } from "../utils/formatters";
import { getRecruitmentTimeline, median, poolVacancies, toDisplayedScore } from "../utils/reportMetrics";
import { InfoTooltip } from "./FilterControls";

interface RegionThreshold {
  wojewodztwo: string;
  score: number;
}

export function LatestResultsCard() {
  const pools = useFilteredPools();
  const places = useFilteredPlaces();
  const przedstawWynikJako = useFilterStore((state) => state.filters.przedstawWynikJako);
  const trybSzkolenia = useFilterStore((state) => state.filters.trybSzkolenia);
  const scoreAsPoints = przedstawWynikJako === "surowa ilość punktów rekrutacyjnych (poglądowo)";

  const model = useMemo(() => {
    const rekrutacja = getRecruitmentTimeline(pools, places).completed[0] ?? null;
    const recruitmentPools = pools.filter((pool) => pool.rekrutacja === rekrutacja);
    const thresholds: RegionThreshold[] = recruitmentPools
      .filter((pool) => pool.status_konkurencyjnosci === "full")
      .map((pool) => ({
        wojewodztwo: pool.wojewodztwo,
        score: toDisplayedScore(pool.najnizszy_wynik_proc, trybSzkolenia, scoreAsPoints),
      }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score);

    const knownCapacity = recruitmentPools.filter((pool) => pool.liczba_miejsc !== null && pool.liczba_miejsc > 0);
    const capacity = knownCapacity.reduce((total, pool) => total + (pool.liczba_miejsc ?? 0), 0);
    const vacanciesByRegion = knownCapacity.map((pool) => poolVacancies(pool) ?? 0);
    const vacancies = vacanciesByRegion.reduce((total, value) => total + value, 0);

    return {
      rekrutacja,
      thresholds,
      medianScore: median(thresholds.map((item) => item.score)),
      capacity,
      filled: capacity - vacancies,
      vacancies,
      regionsWithVacancies: vacanciesByRegion.filter((value) => value > 0).length,
    };
  }, [places, pools, scoreAsPoints, trybSzkolenia]);

  const format = (value: number) => formatByType(value, "score", scoreAsPoints);
  const { thresholds } = model;
  const lowest = thresholds[0];
  const highest = thresholds[thresholds.length - 1];
  const span = lowest && highest ? highest.score - lowest.score : 0;
  const filledShare = model.capacity > 0 ? (model.filled / model.capacity) * 100 : 0;

  if (!model.rekrutacja) {
    return (
      <section className="kpi-card results-card">
        <div className="kpi-label">Wyniki ostatniej rekrutacji</div>
        <p className="results-note">Brak rozstrzygniętych rekrutacji dla tej specjalizacji.</p>
      </section>
    );
  }

  const placesNote =
    model.vacancies === 0
      ? "Wszystkie zajęte — o każde miejsce decydował wynik."
      : `${formatNumber(model.filled)} ${pluralize(model.filled, ["zajęte", "zajęte", "zajętych"])}, ` +
        `${formatNumber(model.vacancies)} ${pluralize(model.vacancies, ["zostało wolne", "zostały wolne", "zostało wolnych"])} ` +
        `(${formatNumber(model.regionsWithVacancies)} ${pluralize(model.regionsWithVacancies, ["województwo", "województwa", "województw"])}).`;

  return (
    <section className="kpi-card results-card" aria-label={`Wyniki · ${formatRecruitmentName(model.rekrutacja)}`}>
      <div className="kpi-label">
        Ostatnie wyniki · {formatRecruitmentName(model.rekrutacja)}
      </div>

      <div className="results-section">
        {thresholds.length === 0 ? (
          <>
            <div className="results-headline">
              <strong>brak progu</strong>
            </div>
            <p className="results-note">W każdym województwie zostały wolne miejsca, więc nigdzie nie było progu.</p>
          </>
        ) : (
          <>
            <div className="results-headline">
              <strong>{format(model.medianScore)}</strong>
              <span>
                {thresholds.length === 1 ? "próg" : "typowy próg"}
                <InfoTooltip text="Mediana progów z województw, w których wszystkie miejsca zostały zajęte." />
              </span>
            </div>
            {span > 0 && (
              <p className="results-note">
                od <b>{format(lowest.score)}</b> ({lowest.wojewodztwo}) do <b>{format(highest.score)}</b> (
                {highest.wojewodztwo})
              </p>
            )}
          </>
        )}
      </div>

      {model.capacity > 0 && (
        <div className="results-section results-section-fill">
          <div className="results-headline secondary">
            <strong>{formatNumber(model.capacity)}</strong>
            <span>{pluralize(model.capacity, ["miejsce było dostępne", "miejsca były dostępne", "miejsc było dostępnych"])}</span>
          </div>
          <div
            className="fill-bar"
            role="img"
            aria-label={`${model.filled} z ${model.capacity} miejsc zajętych, ${model.vacancies} wolnych`}
          >
            <span className="fill-bar-filled" style={{ width: `${filledShare}%` }} />
          </div>
          <p className="results-note">{placesNote}</p>
        </div>
      )}
    </section>
  );
}

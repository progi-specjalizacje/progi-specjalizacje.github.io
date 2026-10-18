import { getReportOptions } from "../data/reportData";
import type { OfferedPlaces, RecruitmentPool, TrybSzkolenia } from "../types";

export interface RecruitmentSummary {
  rekrutacja: string;
  minThreshold: number;
  medianThreshold: number;
  maxThreshold: number;
  totalPlaces: number;
  /** Zakwalifikowani w pulach o znanej liczbie miejsc (nie więcej niż liczba miejsc w puli). */
  filledPlaces: number;
  /** Miejsca w pulach, dla których znamy liczbę zakwalifikowanych. */
  fillablePlaces: number;
  vacancies: number;
  regionsWithVacancies: number;
}

export interface RecruitmentTimeline {
  /** Najbliższa rekrutacja z opublikowanymi miejscami, ale bez wyników. */
  upcoming: string | null;
  /** Rekrutacje z wynikami, od najnowszej. */
  completed: string[];
  /** Rekrutacja, której miejsca pokazujemy jako główne: zapowiedziana albo ostatnia rozstrzygnięta. */
  focus: string | null;
  /** Ten sam sezon rok wcześniej co `focus`. */
  comparison: string | null;
}

function finiteValues(values: number[]) {
  return values.filter((value) => Number.isFinite(value));
}

export function median(values: number[]) {
  const sorted = finiteValues(values).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;

  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function average(values: number[]) {
  const filtered = finiteValues(values);
  if (filtered.length === 0) return Number.NaN;

  return filtered.reduce((total, value) => total + value, 0) / filtered.length;
}

export function sameSeasonPreviousYear(rekrutacja: string) {
  const match = /^([wj])-(\d{4})$/.exec(rekrutacja);
  return match ? `${match[1]}-${Number(match[2]) - 1}` : null;
}

export function getRecruitmentTimeline(pools: RecruitmentPool[], places: OfferedPlaces[]): RecruitmentTimeline {
  const options = getReportOptions();
  const placesRecruitments = new Set(places.map((place) => place.rekrutacja));
  const poolRecruitments = new Set(pools.map((pool) => pool.rekrutacja));
  const upcoming = options.zapowiedzianeRekrutacje.find((rekrutacja) => placesRecruitments.has(rekrutacja)) ?? null;
  const completed = options.rekrutacje.filter((rekrutacja) => poolRecruitments.has(rekrutacja));
  const focus = upcoming ?? completed[0] ?? null;

  return {
    upcoming,
    completed,
    focus,
    comparison: focus ? sameSeasonPreviousYear(focus) : null,
  };
}

/** Wolne miejsca w puli; null, gdy nie znamy liczby oferowanych miejsc. */
export function poolVacancies(pool: RecruitmentPool) {
  if (pool.liczba_miejsc === null) return null;
  return Math.max(0, pool.liczba_miejsc - pool.liczba_zakwalifikowanych);
}

export function placesFor(places: OfferedPlaces[], rekrutacja: string | null) {
  if (!rekrutacja) return Number.NaN;
  const matching = places.filter((place) => place.rekrutacja === rekrutacja);
  if (matching.length === 0) return Number.NaN;
  return matching.reduce((total, place) => total + place.liczba_miejsc, 0);
}

export function toDisplayedScore(scoreProc: number | null, trybSzkolenia: TrybSzkolenia, scoreAsPoints: boolean) {
  if (scoreProc === null || !Number.isFinite(scoreProc)) return Number.NaN;
  if (!scoreAsPoints) return scoreProc;
  const maximum = trybSzkolenia === "Rezydencki" ? 210 : 220;
  return Math.round((scoreProc / 100) * maximum);
}

export function summarizeRecruitment(
  pools: RecruitmentPool[],
  places: OfferedPlaces[],
  rekrutacja: string,
): RecruitmentSummary {
  const recruitmentPools = pools.filter((pool) => pool.rekrutacja === rekrutacja);
  const thresholds = recruitmentPools
    .filter((pool) => pool.status_konkurencyjnosci === "full")
    .map((pool) => pool.najnizszy_wynik_proc ?? Number.NaN)
    .filter((value) => Number.isFinite(value));
  const vacanciesByPool = recruitmentPools
    .map(poolVacancies)
    .filter((value): value is number => value !== null);
  const knownCapacityPools = recruitmentPools.filter((pool) => pool.liczba_miejsc !== null);
  const fillablePlaces = knownCapacityPools.reduce((total, pool) => total + (pool.liczba_miejsc ?? 0), 0);
  const filledPlaces = knownCapacityPools.reduce(
    (total, pool) => total + Math.min(pool.liczba_zakwalifikowanych, pool.liczba_miejsc ?? 0),
    0,
  );
  const poolPlaces = finiteValues(recruitmentPools.map((pool) => pool.liczba_miejsc ?? Number.NaN));
  const listedPlaces = placesFor(places, rekrutacja);

  return {
    rekrutacja,
    minThreshold: thresholds.length > 0 ? Math.min(...thresholds) : Number.NaN,
    medianThreshold: median(thresholds),
    maxThreshold: thresholds.length > 0 ? Math.max(...thresholds) : Number.NaN,
    totalPlaces: Number.isFinite(listedPlaces)
      ? listedPlaces
      : poolPlaces.length > 0
        ? poolPlaces.reduce((total, value) => total + value, 0)
        : Number.NaN,
    filledPlaces: knownCapacityPools.length > 0 ? filledPlaces : Number.NaN,
    fillablePlaces: knownCapacityPools.length > 0 ? fillablePlaces : Number.NaN,
    vacancies: vacanciesByPool.length > 0 ? vacanciesByPool.reduce((total, value) => total + value, 0) : Number.NaN,
    regionsWithVacancies: vacanciesByPool.filter((value) => value > 0).length,
  };
}

export function summarizeRecruitments(pools: RecruitmentPool[], places: OfferedPlaces[], rekrutacje: string[]) {
  return rekrutacje.map((rekrutacja) => summarizeRecruitment(pools, places, rekrutacja));
}

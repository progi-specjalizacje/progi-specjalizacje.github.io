import type { DashboardMetric, RecruitmentPool, ReportRow } from "../types";

export interface RecruitmentSummary {
  rekrutacja: string;
  averageThreshold: number;
  medianQualifiedScore: number;
  totalPlaces: number;
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

function poolKey(pool: RecruitmentPool) {
  return `${pool.rekrutacja}::${pool.wojewodztwo}`;
}

export function summarizeRecruitment(
  rows: ReportRow[],
  pools: RecruitmentPool[],
  rekrutacja: string,
): RecruitmentSummary {
  const recruitmentRows = rows.filter((row) => row.rekrutacja === rekrutacja);
  const recruitmentPools = pools.filter((pool) => pool.rekrutacja === rekrutacja);
  const fullRegions = recruitmentPools
    .filter((pool) => pool.status_konkurencyjnosci === "full")
    .map((pool) => pool.wojewodztwo);
  const thresholdsByRegion = fullRegions.map((region) => {
    const regionRows = recruitmentRows.filter((row) => row.wojewodztwo === region);
    return Math.min(...regionRows.map((row) => row.wynik_proc_lub_punkty));
  });
  const offeredPlaces = finiteValues(recruitmentPools.map((pool) => pool.liczba_miejsc ?? Number.NaN));

  return {
    rekrutacja,
    averageThreshold: average(thresholdsByRegion),
    medianQualifiedScore: average(recruitmentRows.map((row) => row.wynik_proc_lub_punkty)),
    totalPlaces: offeredPlaces.length === 0 ? Number.NaN : offeredPlaces.reduce((total, value) => total + value, 0),
  };
}

export function summarizeRecruitments(rows: ReportRow[], pools: RecruitmentPool[], rekrutacje: string[]) {
  return rekrutacje.map((rekrutacja) => summarizeRecruitment(rows, pools, rekrutacja));
}

export function summarizeActiveFilters(
  rows: ReportRow[],
  pools: RecruitmentPool[],
): Pick<RecruitmentSummary, DashboardMetric> {
  const fullPoolKeys = new Set(
    pools.filter((pool) => pool.status_konkurencyjnosci === "full").map(poolKey),
  );
  const thresholdsByRegion = [...fullPoolKeys].map((key) => {
    const [rekrutacja, wojewodztwo] = key.split("::");
    const regionRows = rows.filter((row) => row.rekrutacja === rekrutacja && row.wojewodztwo === wojewodztwo);
    return Math.min(...regionRows.map((row) => row.wynik_proc_lub_punkty));
  });
  const offeredPlaces = finiteValues(pools.map((pool) => pool.liczba_miejsc ?? Number.NaN));

  return {
    averageThreshold: average(thresholdsByRegion),
    medianQualifiedScore: average(rows.map((row) => row.wynik_proc_lub_punkty)),
    totalPlaces: offeredPlaces.length === 0 ? Number.NaN : offeredPlaces.reduce((total, value) => total + value, 0),
  };
}

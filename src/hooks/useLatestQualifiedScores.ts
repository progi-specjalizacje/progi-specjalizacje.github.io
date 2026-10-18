import { useMemo } from "react";
import { getReportOptions } from "../data/reportData";
import { useCalculatorStore } from "../state/calculatorStore";
import { useFilterStore } from "../state/filterStore";

export interface QualifiedEntry {
  score: number;
  // True when the candidate's regional pool was not fully filled, so nobody competed for the place.
  open: boolean;
}

export interface PoolSummary {
  pools: number;
  openPools: number;
  freePlaces: number;
}

// Nationwide scores of qualified candidates from the newest round that has data
// for the selected specialty and the calculator's training mode.
export function useLatestQualifiedScores() {
  const specialty = useFilterStore((state) => state.filters.dziedzinaMedycyny);
  const activeData = useFilterStore((state) => state.activeData);
  const activePools = useFilterStore((state) => state.activePools);
  const tryb = useCalculatorStore((state) => state.tryb);

  return useMemo(() => {
    const rows = activeData.filter(
      (row) =>
        row.dziedzina_medycyny === specialty && row.tryb_szkolenia === tryb && row.czy_miejsca_doktoranckie !== "TAK",
    );
    const present = new Set(rows.map((row) => row.rekrutacja));
    const latestRound = getReportOptions().rekrutacje.find((round) => present.has(round)) ?? null;

    const pools = activePools.filter(
      (pool) => pool.rekrutacja === latestRound && pool.dziedzina_medycyny === specialty && pool.tryb_szkolenia === tryb,
    );
    const fullRegions = new Set(
      pools.filter((pool) => pool.status_konkurencyjnosci === "full").map((pool) => pool.wojewodztwo),
    );
    const openPools = pools.filter((pool) => pool.status_konkurencyjnosci !== "full");
    const poolSummary: PoolSummary = {
      pools: pools.length,
      openPools: openPools.length,
      freePlaces: openPools
        .filter((pool) => pool.status_konkurencyjnosci === "underfilled" && pool.liczba_miejsc !== null)
        .reduce((total, pool) => total + Math.max(0, (pool.liczba_miejsc ?? 0) - pool.liczba_zakwalifikowanych), 0),
    };

    const entries: QualifiedEntry[] = rows
      .filter((row) => row.rekrutacja === latestRound)
      .map((row) => ({ score: row.punktacja_proc, open: !fullRegions.has(row.wojewodztwo) }));

    return { specialty, tryb, latestRound, entries, poolSummary };
  }, [activeData, activePools, specialty, tryb]);
}

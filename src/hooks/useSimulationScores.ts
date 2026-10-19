import { useMemo } from "react";
import { getReportOptions } from "../data/reportData";
import { useCalculatorStore } from "../state/calculatorStore";
import { useFilterStore } from "../state/filterStore";
import { poolVacancies } from "../utils/reportMetrics";
import { calculateUserPercent } from "../utils/userScore";

export interface QualifiedEntry {
  score: number;
  wojewodztwo: string;
  // True when the candidate's regional pool was not fully filled, so nobody competed for the place.
  open: boolean;
}

export interface PoolSummary {
  pools: number;
  openPools: number;
  freePlaces: number;
}

// The calculator's score in the shared training mode, plus the exam-only score
// (the gap between them is what the extra achievements add).
export function useUserScore() {
  const tryb = useFilterStore((state) => state.filters.trybSzkolenia);
  const calculator = useCalculatorStore();

  return useMemo(() => {
    const userPercent = calculateUserPercent({ ...calculator, tryb });
    const basePercent = calculateUserPercent({
      ...calculator,
      tryb,
      hasPhD: false,
      hasExperience: false,
      isAcademicTeacher: false,
      publicationsCount: 0,
    });
    return { tryb, userPercent, basePercent };
  }, [calculator, tryb]);
}

// Qualified candidates nationwide for the histogram and the simulation table. Both read the
// same recruitment round, so changing it in either view updates both.
export function useSimulationScores() {
  const specialty = useFilterStore((state) => state.filters.dziedzinaMedycyny);
  const tryb = useFilterStore((state) => state.filters.trybSzkolenia);
  const activeData = useFilterStore((state) => state.activeData);
  const activePools = useFilterStore((state) => state.activePools);
  const selectedRound = useCalculatorStore((state) => state.simulationRecruitment);

  return useMemo(() => {
    const specialtyRows = activeData.filter(
      (row) =>
        row.dziedzina_medycyny === specialty && row.tryb_szkolenia === tryb && row.czy_miejsca_doktoranckie !== "TAK",
    );
    const present = new Set(specialtyRows.map((row) => row.rekrutacja));
    const rounds = getReportOptions().rekrutacje.filter((round) => present.has(round));
    // A round chosen for another specialty or mode may have no data here; fall back to the newest one.
    const round = rounds.includes(selectedRound) ? selectedRound : (rounds[0] ?? null);

    const regions = [...new Set(activeData.map((row) => row.wojewodztwo))].sort((a, b) => a.localeCompare(b, "pl"));

    const roundRows = specialtyRows.filter((row) => row.rekrutacja === round);
    const roundPools = activePools.filter(
      (pool) => pool.rekrutacja === round && pool.dziedzina_medycyny === specialty && pool.tryb_szkolenia === tryb,
    );
    const fullRegions = new Set(
      roundPools.filter((pool) => pool.status_konkurencyjnosci === "full").map((pool) => pool.wojewodztwo),
    );
    const openPools = roundPools.filter((pool) => pool.status_konkurencyjnosci !== "full");
    const poolSummary: PoolSummary = {
      pools: roundPools.length,
      openPools: openPools.length,
      freePlaces: openPools
        // Pools where nobody qualified ("no_accepted") have all their places free, too.
        .reduce((total, pool) => total + (poolVacancies(pool) ?? 0), 0),
    };

    const entries: QualifiedEntry[] = roundRows.map((row) => ({
      score: row.punktacja_proc,
      wojewodztwo: row.wojewodztwo,
      open: !fullRegions.has(row.wojewodztwo),
    }));

    return { specialty, tryb, rounds, round, regions, entries, poolSummary };
  }, [activeData, activePools, selectedRound, specialty, tryb]);
}

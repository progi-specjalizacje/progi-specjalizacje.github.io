import { useMemo } from "react";
import { useFilterStore } from "../state/filterStore";

export function useFilteredPools() {
  const filters = useFilterStore((state) => state.filters);
  const activePools = useFilterStore((state) => state.activePools);

  return useMemo(
    () =>
      activePools.filter(
        (pool) =>
          pool.tryb_szkolenia === filters.trybSzkolenia &&
          pool.dziedzina_medycyny === filters.dziedzinaMedycyny,
      ),
    [activePools, filters.dziedzinaMedycyny, filters.trybSzkolenia],
  );
}

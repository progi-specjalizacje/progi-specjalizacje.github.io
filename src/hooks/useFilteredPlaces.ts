import { useMemo } from "react";
import { useFilterStore } from "../state/filterStore";

export function useFilteredPlaces() {
  const filters = useFilterStore((state) => state.filters);
  const activePlaces = useFilterStore((state) => state.activePlaces);

  return useMemo(
    () =>
      activePlaces.filter(
        (place) =>
          place.tryb_szkolenia === filters.trybSzkolenia &&
          place.dziedzina_medycyny === filters.dziedzinaMedycyny,
      ),
    [activePlaces, filters.dziedzinaMedycyny, filters.trybSzkolenia],
  );
}

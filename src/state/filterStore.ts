import { create } from "zustand";
import { getReportOptions, fetchSpecialtyData, fetchSpecialtyPlaces, fetchSpecialtyPools } from "../data/reportData";
import type {
  OfferedPlaces,
  PrzedstawWynikJako,
  RecruitmentPool,
  ReportFilters,
  ReportRow,
  TrybSzkolenia,
} from "../types";

const options = getReportOptions();

const defaultFilters: ReportFilters = {
  trybSzkolenia: "Rezydencki",
  dziedzinaMedycyny:
    options.dziedziny.find((item) => item === "Otorynolaryngologia") ?? options.dziedziny[0] ?? "",
  przedstawWynikJako: "% punktów rekrutacyjnych (domyślne)",
};

interface FilterStore {
  filters: ReportFilters;
  activeData: ReportRow[];
  activePools: RecruitmentPool[];
  activePlaces: OfferedPlaces[];
  isLoading: boolean;
  setTrybSzkolenia: (trybSzkolenia: TrybSzkolenia) => void;
  setDziedzinaMedycyny: (dziedzinaMedycyny: string) => Promise<void>;
  setPrzedstawWynikJako: (przedstawWynikJako: PrzedstawWynikJako) => void;
  resetFilters: () => void;
  loadSpecialtyData: (specialty: string) => Promise<void>;
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  filters: defaultFilters,
  activeData: [],
  activePools: [],
  activePlaces: [],
  isLoading: false,
  setTrybSzkolenia: (trybSzkolenia) => set((state) => ({ filters: { ...state.filters, trybSzkolenia } })),
  setDziedzinaMedycyny: async (dziedzinaMedycyny) => {
    set((state) => ({ filters: { ...state.filters, dziedzinaMedycyny } }));
    await get().loadSpecialtyData(dziedzinaMedycyny);
  },
  setPrzedstawWynikJako: (przedstawWynikJako) =>
    set((state) => ({ filters: { ...state.filters, przedstawWynikJako } })),
  resetFilters: () => {
    const prevSpecialty = get().filters.dziedzinaMedycyny;
    set({ filters: defaultFilters });
    if (defaultFilters.dziedzinaMedycyny !== prevSpecialty) {
      get().loadSpecialtyData(defaultFilters.dziedzinaMedycyny);
    }
  },
  loadSpecialtyData: async (specialty) => {
    set({ isLoading: true });
    try {
      const [data, pools, places] = await Promise.all([
        fetchSpecialtyData(specialty),
        fetchSpecialtyPools(specialty),
        fetchSpecialtyPlaces(specialty),
      ]);
      set({ activeData: data, activePools: pools, activePlaces: places, isLoading: false });
    } catch (error) {
      console.error("Failed to load data for specialty", specialty, error);
      set({ activeData: [], activePools: [], activePlaces: [], isLoading: false });
    }
  },
}));

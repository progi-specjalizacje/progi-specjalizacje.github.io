import {
  DENTAL_SPECIALTIES,
  LIMIT_SPECIALTY_SEARCH,
  getMedicalSpecialties,
} from "../config/specialtySearchFilter";
import type {
  OfferedPlaces,
  PrzedstawWynikJako,
  RecruitmentPool,
  ReportFilters,
  ReportRow,
  ThresholdForecast,
  TrybSzkolenia,
} from "../types";
import * as metadata from "./reportMetadata";

export const wynikPresentationOptions: PrzedstawWynikJako[] = [
  "% punktów rekrutacyjnych (domyślne)",
  "surowa ilość punktów rekrutacyjnych (poglądowo)",
];

function calculateWynikWPunktach(punktacjaProc: number, trybSzkolenia: TrybSzkolenia) {
  const maxPoints = trybSzkolenia === "Rezydencki" ? 210 : 220;
  return Math.round((punktacjaProc / 100) * maxPoints);
}

function calculateWynikProcLubPunkty(row: ReportRow, przedstawWynikJako: PrzedstawWynikJako) {
  if (przedstawWynikJako === "surowa ilość punktów rekrutacyjnych (poglądowo)") {
    return row.wynik_w_punktach;
  }
  return row.punktacja_proc;
}

export const MEDICAL_SPECIALTIES = getMedicalSpecialties(metadata.dziedziny);

function getSearchableDziedziny(): string[] {
  if (!LIMIT_SPECIALTY_SEARCH) {
    return metadata.dziedziny;
  }

  const allowed = new Set<string>(DENTAL_SPECIALTIES);
  return metadata.dziedziny.filter((dziedzina) => allowed.has(dziedzina));
}

export function getReportOptions() {
  return {
    dziedziny: getSearchableDziedziny(),
    przedstawWynikJako: wynikPresentationOptions,
    rekrutacje: metadata.rekrutacje,
    zapowiedzianeRekrutacje: metadata.zapowiedzianeRekrutacje,
    tryby: metadata.tryby,
  };
}

// In-memory cache for loaded specialty JSONs
const specialtyCache: Record<string, ReportRow[]> = {};
const specialtyPoolCache: Record<string, RecruitmentPool[]> = {};
const specialtyPlacesCache: Record<string, OfferedPlaces[]> = {};

export async function fetchSpecialtyData(specialty: string): Promise<ReportRow[]> {
  if (specialtyCache[specialty]) {
    return specialtyCache[specialty];
  }

  const fileName = metadata.specialtyFilesMap[specialty];
  if (!fileName) {
    console.warn(`No static file mapping found for specialty: ${specialty}`);
    return [];
  }

  try {
    const response = await fetch(`/data/${fileName}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch data for specialty "${specialty}": ${response.statusText}`);
    }
    const data = (await response.json()) as ReportRow[];

    // Calculate derived values on the client side
    const parsedData = data.map((row) => {
      row.wynik_w_punktach = calculateWynikWPunktach(row.punktacja_proc, row.tryb_szkolenia);
      row.wynik_proc_lub_punkty = row.punktacja_proc;
      return row;
    });

    specialtyCache[specialty] = parsedData;
    return parsedData;
  } catch (error) {
    console.error("Error loading specialty data:", error);
    return [];
  }
}

export async function fetchSpecialtyPools(specialty: string): Promise<RecruitmentPool[]> {
  if (specialtyPoolCache[specialty]) return specialtyPoolCache[specialty];

  const fileName = metadata.specialtyPoolFilesMap[specialty];
  if (!fileName) return [];

  try {
    const response = await fetch(`/data/${fileName}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch pool data for "${specialty}": ${response.statusText}`);
    }
    const data = (await response.json()) as RecruitmentPool[];
    specialtyPoolCache[specialty] = data;
    return data;
  } catch (error) {
    console.error("Error loading pool data:", error);
    return [];
  }
}

export async function fetchSpecialtyPlaces(specialty: string): Promise<OfferedPlaces[]> {
  if (specialtyPlacesCache[specialty]) return specialtyPlacesCache[specialty];

  const fileName = metadata.specialtyPlacesFilesMap[specialty];
  if (!fileName) return [];

  try {
    const response = await fetch(`/data/${fileName}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch places data for "${specialty}": ${response.statusText}`);
    }
    const data = (await response.json()) as OfferedPlaces[];
    specialtyPlacesCache[specialty] = data;
    return data;
  } catch (error) {
    console.error("Error loading places data:", error);
    return [];
  }
}

let forecastPromise: Promise<ThresholdForecast[]> | null = null;

/** Prognozy progów na zapowiedzianą rundę (jeden mały plik). */
export function fetchThresholdForecast(): Promise<ThresholdForecast[]> {
  if (!forecastPromise) {
    forecastPromise = fetch("/data/forecast.json")
      .then((response) => {
        if (!response.ok) throw new Error(response.statusText);
        return response.json() as Promise<ThresholdForecast[]>;
      })
      .catch((error) => {
        console.error("Error loading threshold forecast:", error);
        forecastPromise = null;
        return [];
      });
  }
  return forecastPromise;
}

export interface ScoreChoiceRow {
  rekrutacja: string;
  tryb: TrybSzkolenia;
  specjalizacja: string;
  /** Liczba zakwalifikowanych w kolejnych przedziałach punktacji (szerokość: `binWidth` p.p.). */
  bins: number[];
}

export interface ScorePlacesRow {
  rekrutacja: string;
  tryb: TrybSzkolenia;
  specjalizacja: string;
  /** Liczba oferowanych miejsc w kraju (suma po województwach). */
  miejsca: number;
}

export interface ScoreChoices {
  binWidth: number;
  places: ScorePlacesRow[];
  rows: ScoreChoiceRow[];
}

let scoreChoicesPromise: Promise<ScoreChoices | null> | null = null;

/** Rozkład wyborów specjalizacji według wyniku dla wszystkich specjalizacji (jeden mały plik). */
export function fetchScoreChoices(): Promise<ScoreChoices | null> {
  if (!scoreChoicesPromise) {
    scoreChoicesPromise = fetch("/data/score_choices.json")
      .then((response) => {
        if (!response.ok) throw new Error(response.statusText);
        return response.json() as Promise<ScoreChoices>;
      })
      .catch((error) => {
        console.error("Error loading score choices:", error);
        scoreChoicesPromise = null;
        return null;
      });
  }
  return scoreChoicesPromise;
}

export function applyReportFilters(rows: ReportRow[], filters: ReportFilters): ReportRow[] {
  return rows
    .filter(
      (row) =>
        row.tryb_szkolenia === filters.trybSzkolenia &&
        row.dziedzina_medycyny === filters.dziedzinaMedycyny &&
        row.czy_miejsca_doktoranckie !== "TAK",
    )
    .map((row) => ({
      ...row,
      wynik_proc_lub_punkty: calculateWynikProcLubPunkty(row, filters.przedstawWynikJako),
    }));
}

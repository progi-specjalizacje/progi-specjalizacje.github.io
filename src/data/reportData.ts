import {
  DENTAL_SPECIALTIES,
  LIMIT_SPECIALTY_SEARCH,
  getMedicalSpecialties,
} from "../config/specialtySearchFilter";
import type { PrzedstawWynikJako, ReportFilters, ReportRow, TrybSzkolenia } from "../types";
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
    tryby: metadata.tryby,
  };
}

// In-memory cache for loaded specialty JSONs
const specialtyCache: Record<string, ReportRow[]> = {};

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

/**
 * Tymczasowe ograniczenie listy w polu „Wybór specjalizacji”.
 * Aby przywrócić pełną listę, ustaw LIMIT_SPECIALTY_SEARCH na false.
 */
export const LIMIT_SPECIALTY_SEARCH = false;

export const DENTAL_SPECIALTIES = [
  "Ortodoncja",
  "Protetyka stomatologiczna",
  "Chirurgia stomatologiczna",
  "Stomatologia zachowawcza z endodoncją",
  "Periodontologia",
  "Stomatologia dziecięca",
  "Chirurgia szczękowo-twarzowa",
  "Zdrowie publiczne",
] as const;

const dentalSpecialtySet = new Set<string>(DENTAL_SPECIALTIES);

export function getMedicalSpecialties(allSpecialties: readonly string[]): string[] {
  return allSpecialties.filter((specialty) => !dentalSpecialtySet.has(specialty));
}

export function isDentalSpecialty(specialty: string): boolean {
  return dentalSpecialtySet.has(specialty);
}

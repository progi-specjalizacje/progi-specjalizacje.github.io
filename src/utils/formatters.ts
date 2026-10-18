export function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits }).format(value);
}

export function formatPercentPoints(value: number) {
  return `${formatNumber(value, 2)}%`;
}

export function formatByType(value: number, type?: "number" | "percent" | "score", scoreAsPoints = false) {
  if (type === "score") {
    return scoreAsPoints ? formatNumber(value) : formatPercentPoints(value);
  }

  if (type === "percent") return formatPercentPoints(value);
  return formatNumber(value, Number.isInteger(value) ? 0 : 1);
}

export function formatSignedNumber(value: number) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`;
}

/** "j-2026" → "jesień 2026", "w-2026" → "wiosna 2026". */
export function formatRecruitmentName(rekrutacja: string) {
  const match = /^([wj])-(\d{4})$/.exec(rekrutacja);
  if (!match) return rekrutacja;
  return `${match[1] === "j" ? "jesień" : "wiosna"} ${match[2]}`;
}

/** Polska odmiana liczebnika: [1 miejsce, 2 miejsca, 5 miejsc]. */
export function pluralize(count: number, forms: [string, string, string]) {
  const abs = Math.abs(count);
  if (abs === 1) return forms[0];
  const lastDigit = abs % 10;
  const lastTwoDigits = abs % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) return forms[1];
  return forms[2];
}

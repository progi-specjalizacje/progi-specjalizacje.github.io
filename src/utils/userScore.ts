import type { CalculatorState } from "../state/calculatorStore";
import type { TrybSzkolenia } from "../types";

type UserScoreInput = Pick<
  CalculatorState,
  "examPoints" | "maxExamPoints" | "hasPhD" | "hasExperience" | "isAcademicTeacher" | "publicationsCount"
> & { tryb: TrybSzkolenia };

// Mirrors the point rules shown in the calculator: residency adds PhD and publications,
// non-residency also adds work experience and, only on top of it, academic teaching.
export function calculateUserPercent(input: UserScoreInput) {
  const actualExamPoints = Math.min(input.examPoints, input.maxExamPoints);
  let extraPoints = (input.hasPhD ? 5 : 0) + Math.min(5, input.publicationsCount * 0.5);
  let maxExtraPoints = 10;

  if (input.tryb === "Pozarezydencki") {
    extraPoints += input.hasExperience ? 5 + (input.isAcademicTeacher ? 5 : 0) : 0;
    maxExtraPoints = 20;
  }

  const maxPossiblePoints = input.maxExamPoints + maxExtraPoints;
  return maxPossiblePoints > 0 ? ((actualExamPoints + extraPoints) / maxPossiblePoints) * 100 : 0;
}

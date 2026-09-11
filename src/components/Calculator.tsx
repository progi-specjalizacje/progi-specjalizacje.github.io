import { useState } from "react";
import { useCalculatorStore } from "../state/calculatorStore";
import { formatNumber, formatPercentPoints } from "../utils/formatters";

export function Calculator() {
  const {
    tryb,
    examPoints,
    maxExamPoints,
    hasPhD,
    hasExperience,
    isAcademicTeacher,
    publicationsCount,
    setTryb,
    setExamPoints,
    setMaxExamPoints,
    setHasPhD,
    setHasExperience,
    setIsAcademicTeacher,
    setPublicationsCount,
  } = useCalculatorStore();

  // Keep incomplete keyboard input separate from the value used in calculations.
  const [maxExamPointsDraft, setMaxExamPointsDraft] = useState<string | null>(null);

  const actualExamPoints = Math.min(examPoints, maxExamPoints);

  // Residency vs Non-residency point logic
  const phdPoints = hasPhD ? 5 : 0;
  const pubPoints = Math.min(5, publicationsCount * 0.5);

  let extraPoints = phdPoints + pubPoints;
  let maxExtraPoints = 10; // PhD (5) + Pub (5)

  if (tryb === "Pozarezydencki") {
    const expPoints = hasExperience ? 5 : 0;
    const academicPoints = isAcademicTeacher ? 5 : 0;
    extraPoints += expPoints + academicPoints;
    maxExtraPoints = 20; // PhD (5) + Exp (5) + Acad (5) + Pub (5)
  }

  const obtainedPoints = actualExamPoints + extraPoints;
  const maxPossiblePoints = maxExamPoints + maxExtraPoints;
  const obtainedPercentage = maxPossiblePoints > 0 ? (obtainedPoints / maxPossiblePoints) * 100 : 0;

  const handleExamPointsChange = (value: number) => {
    const clamped = Math.max(0, Math.min(value, maxExamPoints));
    setExamPoints(clamped);
  };

  const handleMaxExamPointsChange = (value: number) => {
    const clampedMax = Math.max(190, Math.min(200, Number.isNaN(value) ? 190 : value));
    setMaxExamPoints(clampedMax);
    if (examPoints > clampedMax) {
      setExamPoints(clampedMax);
    }
  };

  const handlePublicationsCountChange = (value: number) => {
    const clamped = Math.max(0, Math.min(10, Number.isNaN(value) ? 0 : value));
    setPublicationsCount(clamped);
  };

  return (
    <section className="calculator-card" aria-label="Kalkulator punktów rekrutacyjnych">
      <div className="calculator-header">
        <span>Kalkulator punktów</span>
      </div>

      <div className="calculator-body">
        {/* Mode Selector */}
        <div className="calculator-group">
          <label className="calculator-label">Tryb rekrutacji</label>
          <div className="button-group compact">
            <button
              className={tryb === "Rezydencki" ? "active" : ""}
              type="button"
              onClick={() => setTryb("Rezydencki")}
            >
              Rezydencki
            </button>
            <button
              className={tryb === "Pozarezydencki" ? "active" : ""}
              type="button"
              onClick={() => setTryb("Pozarezydencki")}
            >
              Pozarezydencki
            </button>
          </div>
        </div>

        {/* Exam Points Input */}
        <div className="calculator-group">
          <div className="input-row-between">
            <label className="calculator-label">Punkty z egzaminu (LEK/LDEK)</label>
            <input
              type="number"
              className="numeric-input compact-input"
              value={examPoints}
              min={0}
              max={maxExamPoints}
              step={1}
              onChange={(e) => handleExamPointsChange(Number(e.target.value))}
            />
          </div>
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={maxExamPoints}
              step={1}
              value={actualExamPoints}
              onChange={(e) => handleExamPointsChange(Number(e.target.value))}
            />
            <span className="slider-limits">{maxExamPoints} max</span>
          </div>
        </div>

        {/* Max Exam Points (for revoked questions) */}
        <div className="calculator-group">
          <div className="input-row-between">
            <label className="calculator-label" htmlFor="max-exam-points">Max punktów z egzaminu (np. po anulowaniu pytań)</label>
            <input
              id="max-exam-points"
              type="number"
              inputMode="numeric"
              className="numeric-input compact-input"
              value={maxExamPointsDraft ?? maxExamPoints}
              min={190}
              max={200}
              step={1}
              onChange={(e) => {
                const draft = e.target.value;
                setMaxExamPointsDraft(draft);
                const value = Number(draft);
                if (draft !== "" && value >= 190 && value <= 200) {
                  handleMaxExamPointsChange(value);
                }
              }}
              onBlur={(e) => {
                if (e.target.value !== "") {
                  handleMaxExamPointsChange(Number(e.target.value));
                }
                setMaxExamPointsDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </div>
        </div>

        {/* Additional Criteria Checkboxes */}
        <div className="calculator-group">
          <div className="checkbox-list">
            <label className="checkbox-filter">
              <input
                type="checkbox"
                checked={hasPhD}
                onChange={(e) => setHasPhD(e.target.checked)}
              />
              <span className="calculator-label">Stopień doktora n. med. (+5 pkt)</span>
            </label>

            {tryb === "Pozarezydencki" && (
              <>
                <label className="checkbox-filter">
                  <input
                    type="checkbox"
                    checked={hasExperience}
                    onChange={(e) => setHasExperience(e.target.checked)}
                  />
                  <span className="calculator-label">Doświadczenie zawodowe min. 3 lata (+5 pkt)</span>
                </label>

                <label className="checkbox-filter">
                  <input
                    type="checkbox"
                    checked={isAcademicTeacher}
                    onChange={(e) => setIsAcademicTeacher(e.target.checked)}
                  />
                  <span className="calculator-label">Nauczyciel akademicki w uczelni med. (+5 pkt)</span>
                </label>
              </>
            )}
          </div>
        </div>

        {/* Publications input */}
        <div className="calculator-group">
          <div className="input-row-between">
            <label className="calculator-label">Ilość opublikowancych artykułów (0.5 pkt/szt, max 5 pkt)</label>
            <input
              type="number"
              className="numeric-input compact-input"
              value={publicationsCount}
              min={0}
              max={10}
              step={1}
              onChange={(e) => handlePublicationsCountChange(Number(e.target.value))}
              onBlur={(e) => handlePublicationsCountChange(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Calculator Output KPI style */}
        <div className="calculator-results">
          <div className="result-kpi">
            <span className="result-label">Surowy wynik punktowy</span>
            <strong className="result-value">
              {formatNumber(obtainedPoints, 1)} / {formatNumber(maxPossiblePoints, 1)}
            </strong>
          </div>
          <div className="result-kpi highlight">
            <span className="result-label">Wynik uwzględniany w rekrutacji</span>
            <strong className="result-value accent-text">
              {formatPercentPoints(obtainedPercentage)}
            </strong>
          </div>
        </div>
      </div>
    </section>
  );
}

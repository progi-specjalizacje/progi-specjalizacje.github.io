import { useState, type ReactNode } from "react";
import { Briefcase, Check, FileText, GraduationCap, Minus, Plus, School } from "lucide-react";
import { useCalculatorStore } from "../state/calculatorStore";
import { useFilterStore } from "../state/filterStore";
import { formatNumber, formatPercentPoints } from "../utils/formatters";
import { InfoTooltip } from "./FilterControls";
import { ScoreHistogram } from "./ScoreHistogram";

const MAX_PUBLICATIONS = 10;

// Quoted from the qualification rules (załącznik nr 7 do rozporządzenia Ministra Zdrowia z dnia 4 maja 2023 r.
// w sprawie specjalizacji lekarzy i lekarzy dentystów, Dz.U. 2023 poz. 975) and art. 16c ust. 10 ustawy
// o zawodach lekarza i lekarza dentysty.
const REGULATION = "Zał. nr 7 do rozporządzenia MZ z 4 maja 2023 r. (Dz.U. 2023 poz. 975)";
const JOURNAL_RULE =
  "publikacje w czasopismach naukowych aktualnego, w dacie opublikowania publikacji naukowej, wykazu czasopism naukowych ujętych w wykazie sporządzonym zgodnie z przepisami wydanymi na podstawie art. 267 ust. 2 pkt 2 lit. b ustawy z dnia 20 lipca 2018 r. – Prawo o szkolnictwie wyższym i nauce";

interface RuleHelpProps {
  label: string;
  quote: string;
  source: string;
  note?: string;
}

function RuleHelp({ label, quote, source, note }: RuleHelpProps) {
  return (
    <InfoTooltip text={`${label}: ${quote} (${source})`}>
      <span className="rule-help">
        <q>{quote}</q>
        <small>{source}</small>
        {note && <span className="rule-help-note">{note}</span>}
      </span>
    </InfoTooltip>
  );
}

interface BonusTileProps {
  icon: ReactNode;
  title: string;
  points: number;
  active: boolean;
  disabled?: boolean;
  hint?: string;
  help: ReactNode;
  onToggle: () => void;
}

function BonusTile({ icon, title, points, active, disabled, hint, help, onToggle }: BonusTileProps) {
  return (
    <div className={`bonus-tile ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}>
      <button
        type="button"
        className="bonus-tile-main"
        aria-pressed={active}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="bonus-icon">{active ? <Check size={20} /> : icon}</span>
        <span className="bonus-text">
          <strong>{title}</strong>
          {hint && <small>{hint}</small>}
        </span>
        <span className="bonus-points">+{points} pkt</span>
      </button>
      {help}
    </div>
  );
}

export function Calculator() {
  // Tryb jest wspólny z raportem: przełącznik tutaj i w pasku ustawień zmienia to samo.
  const tryb = useFilterStore((state) => state.filters.trybSzkolenia);
  const setTryb = useFilterStore((state) => state.setTrybSzkolenia);
  const {
    examPoints,
    maxExamPoints,
    hasPhD,
    hasExperience,
    isAcademicTeacher,
    publicationsCount,
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
    // The academic-teacher bonus is granted only in addition to the 3-year employment bonus.
    const academicPoints = hasExperience && isAcademicTeacher ? 5 : 0;
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
    const clamped = Math.max(0, Math.min(MAX_PUBLICATIONS, Number.isNaN(value) ? 0 : value));
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

        {/* Right under the slider, so the score and its position in the distribution fit on one screen. */}
        <ScoreHistogram />

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

        {/* Extra achievements */}
        <div className="calculator-group">
          <span className="calculator-label">Dodatkowe punkty</span>
          <div className="bonus-grid">
            <div className={`bonus-tile publications-tile ${publicationsCount > 0 ? "active" : ""}`}>
              <div className="publications-head">
                <span className="bonus-icon">
                  <FileText size={20} />
                </span>
                <span className="bonus-text">
                  <strong>Publikacje</strong>
                  <small>0,5 pkt za artykuł, maks. 10 artykułów</small>
                </span>
                <span className="bonus-points">
                  +{formatNumber(pubPoints, 1)}
                  <em> / 5 pkt</em>
                </span>
                <RuleHelp
                  label="Publikacje"
                  quote={`${JOURNAL_RULE} – maksymalnie 5 punktów (po 0,5 punktu za udział w jednej publikacji)`}
                  source={`Art. 16c ust. 10 ustawy o zawodach lekarza i lekarza dentysty; ${REGULATION}, § 1 ust. ${
                    tryb === "Rezydencki" ? "4 pkt 2" : "3 pkt 3"
                  }`}
                  note="Czyli artykuły w czasopismach z ministerialnego wykazu czasopism naukowych, obowiązującego w dniu publikacji. Liczy się udział (także współautorstwo) do dnia rozpoczęcia postępowania."
                />
              </div>
              <div className="publications-control">
                <button
                  type="button"
                  className="publications-step"
                  aria-label="Usuń publikację"
                  disabled={publicationsCount === 0}
                  onClick={() => handlePublicationsCountChange(publicationsCount - 1)}
                >
                  <Minus size={16} />
                </button>
                <div className="publications-pips" role="group" aria-label="Liczba publikacji">
                  {Array.from({ length: MAX_PUBLICATIONS }, (_, index) => {
                    const count = index + 1;
                    const filled = count <= publicationsCount;
                    return (
                      <button
                        key={count}
                        type="button"
                        className={`publication-pip ${filled ? "filled" : ""}`}
                        aria-label={`${count} publikacji`}
                        aria-pressed={filled}
                        title={`${count} × 0,5 pkt`}
                        onClick={() => handlePublicationsCountChange(count === publicationsCount ? count - 1 : count)}
                      />
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="publications-step"
                  aria-label="Dodaj publikację"
                  disabled={publicationsCount >= MAX_PUBLICATIONS}
                  onClick={() => handlePublicationsCountChange(publicationsCount + 1)}
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <BonusTile
              icon={<GraduationCap size={20} />}
              title="Doktorat n. med."
              points={5}
              active={hasPhD}
              help={
                <RuleHelp
                  label="Doktorat"
                  quote="posiadanie stopnia naukowego doktora w zakresie nauk medycznych – 5 punktów"
                  source={`${REGULATION}, § 1 ust. ${tryb === "Rezydencki" ? "4" : "3"} pkt 1`}
                  note="Stopień musi być uzyskany przed rozpoczęciem postępowania kwalifikacyjnego (do 28 lutego albo do 30 września)."
                />
              }
              onToggle={() => setHasPhD(!hasPhD)}
            />
            {tryb === "Pozarezydencki" && (
              <>
                <BonusTile
                  icon={<Briefcase size={20} />}
                  title="3 lata pracy w jednostce akredytowanej"
                  points={5}
                  active={hasExperience}
                  help={
                    <RuleHelp
                      label="Zatrudnienie"
                      quote="co najmniej 3-letni okres zatrudnienia lub stosunku służbowego w ciągu ostatnich pięciu lat, do dnia rozpoczęcia postępowania kwalifikacyjnego, w pełnym wymiarze czasu pracy w jednostce akredytowanej, zgodny z kierunkiem wnioskowanej specjalizacji – 5 punktów"
                      source={`${REGULATION}, § 1 ust. 3 pkt 2`}
                    />
                  }
                  onToggle={() => {
                    if (hasExperience) setIsAcademicTeacher(false);
                    setHasExperience(!hasExperience);
                  }}
                />
                <BonusTile
                  icon={<School size={20} />}
                  title="Nauczyciel akademicki"
                  points={5}
                  active={hasExperience && isAcademicTeacher}
                  disabled={!hasExperience}
                  hint={hasExperience ? undefined : "tylko razem z 3 latami pracy"}
                  help={
                    <RuleHelp
                      label="Nauczyciel akademicki"
                      quote="a w przypadku gdy dana osoba jest również nauczycielem akademickim zatrudnionym w uczelni medycznej lub innej uczelni prowadzącej działalność w dziedzinie nauk medycznych – dodatkowe 5 punktów"
                      source={`${REGULATION}, § 1 ust. 3 pkt 2`}
                      note="Te punkty przysługują wyłącznie jako dodatek do punktów za 3-letnie zatrudnienie w jednostce akredytowanej."
                    />
                  }
                  onToggle={() => setIsAcademicTeacher(!isAcademicTeacher)}
                />
              </>
            )}

          </div>
        </div>
      </div>
    </section>
  );
}

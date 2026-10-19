import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getReportOptions } from "../data/reportData";
import { useFilterStore } from "../state/filterStore";
import type { PrzedstawWynikJako, TrybSzkolenia } from "../types";

const options = getReportOptions();
const scoreHelp =
  "Pamiętaj, że ta wartość to nie procentowy wynik egzaminu końcowego, lecz procent całkowitej liczby punktów rekrutacyjnych (210 dla trybu rezydenckiego, 220 dla pozarezydenckiego).";
const rawScoreHelp = "[Wynik egzaminu + dodatkowe punkty] -wartość przedstawiana dla celów poglądowych, przy założeniu, że nie anulowano żadnego pytania na egzaminie końcowym."
const doctoralPlacesHelp = "Z zestawienia wyłączone są miejsca doktoranckie.";

export function InfoTooltip({ text, children }: { text: string; children?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="info-tooltip"
      tabIndex={0}
      aria-label={text}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span style={{ display: "block", lineHeight: 1 }}>?</span>
      {visible && <span className="info-tooltip-content">{children ?? text}</span>}
    </span>
  );
}

export function DziedzinaSlicer() {
  const dziedzinaMedycyny = useFilterStore((state) => state.filters.dziedzinaMedycyny);
  const setDziedzinaMedycyny = useFilterStore((state) => state.setDziedzinaMedycyny);
  const [query, setQuery] = useState("");
  const visibleOptions = useMemo(
    () =>
      options.dziedziny.filter((option) =>
        option.toLocaleLowerCase("pl").includes(query.toLocaleLowerCase("pl")),
      ),
    [query],
  );

  return (
    <div className="filter-block slicer-block">

      <div className="selected-field">
        <span>Wybrano:</span>
        <strong>{dziedzinaMedycyny}</strong>
      </div>
      <span className="search-input">
        <Search size={15} aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Szukaj dziedziny"
          type="search"
        />
      </span>
      <div className="slicer-list" role="listbox" aria-label="Dziedzina medycyny">
        {visibleOptions.map((option) => (
          <button
            key={option}
            className={dziedzinaMedycyny === option ? "active" : ""}
            type="button"
            onClick={() => setDziedzinaMedycyny(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

const TRYB_LABELS: Record<TrybSzkolenia, string> = {
  Rezydencki: "Rezydentura",
  Pozarezydencki: "Pozarezydencki",
};

const WYNIK_LABELS: Record<PrzedstawWynikJako, { label: string; short: string; help: string }> = {
  "% punktów rekrutacyjnych (domyślne)": { label: "% punktów", short: "%", help: scoreHelp },
  "surowa ilość punktów rekrutacyjnych (poglądowo)": { label: "punkty (poglądowo)", short: "pkt", help: rawScoreHelp },
};

function scrollToSpecialtyPicker() {
  const picker = document.getElementById("field-filter");
  picker?.scrollIntoView({ block: "center" });
  picker?.querySelector<HTMLInputElement>("input[type=search]")?.focus({ preventScroll: true });
}

/** Sekcja kalkulatora ma własny tryb, więc na telefonie chowamy nad nią przyklejony pasek. */
const CALCULATOR_SECTION_IDS = ["calculator-section-title", "kalkulator", "simulation"];
const STICKY_BAR_OFFSET = 80;

/** Czy górna krawędź ekranu (pod paskiem) jest w obrębie sekcji kalkulatora. */
function useOverCalculator() {
  const [overCalculator, setOverCalculator] = useState(false);

  useEffect(() => {
    const update = () => {
      const rects = CALCULATOR_SECTION_IDS.map((id) => document.getElementById(id)?.getBoundingClientRect()).filter(
        (rect): rect is DOMRect => rect !== undefined,
      );
      if (rects.length === 0) return setOverCalculator(false);
      const top = Math.min(...rects.map((rect) => rect.top));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      setOverCalculator(top < STICKY_BAR_OFFSET && bottom > STICKY_BAR_OFFSET);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return overCalculator;
}

/**
 * Przyklejony pasek mówiący, czego dotyczy raport, z ustawieniami wpływającymi na wszystkie widoki raportu.
 * Na telefonie jest zwinięty do jednej linii i rozwija się po dotknięciu.
 */
export function ReportContextBar() {
  const filters = useFilterStore((state) => state.filters);
  const setTrybSzkolenia = useFilterStore((state) => state.setTrybSzkolenia);
  const setPrzedstawWynikJako = useFilterStore((state) => state.setPrzedstawWynikJako);
  const [expanded, setExpanded] = useState(false);
  const overCalculator = useOverCalculator();

  return (
    <div
      className={`context-bar ${expanded ? "expanded" : ""} ${overCalculator ? "over-calculator" : ""}`}
      role="region"
      aria-label="Ustawienia raportu"
    >
      <button
        type="button"
        className="context-bar-compact"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="compact-specialty">{filters.dziedzinaMedycyny}</span>
        <span className="compact-meta">
          {TRYB_LABELS[filters.trybSzkolenia]} · {WYNIK_LABELS[filters.przedstawWynikJako].short}
        </span>
        <span className="compact-action">{expanded ? "zwiń" : "zmień"}</span>
      </button>
      <div className="context-bar-full">
        <div className="context-bar-scope">
          <span className="context-bar-eyebrow">Raport poniżej dotyczy</span>
          <button
            type="button"
            className="context-bar-specialty"
            title={`${filters.dziedzinaMedycyny} — kliknij, aby zmienić specjalizację`}
            onClick={() => {
              setExpanded(false);
              scrollToSpecialtyPicker();
            }}
          >
            <strong>{filters.dziedzinaMedycyny}</strong>
            <span>zmień</span>
          </button>
        </div>
        <div className="context-bar-group">
          <span className="context-bar-label">
            Tryb
            <InfoTooltip text={`${doctoralPlacesHelp} Tryb zmienia miejsca, progi i wolne miejsca we wszystkich kartach, tabeli i wykresie.`} />
          </span>
          <div className="segmented" role="group" aria-label="Tryb szkolenia">
            {options.tryby.map((tryb: TrybSzkolenia) => (
              <button
                key={tryb}
                type="button"
                className={filters.trybSzkolenia === tryb ? "active" : ""}
                aria-pressed={filters.trybSzkolenia === tryb}
                onClick={() => {
                  setTrybSzkolenia(tryb);
                  setExpanded(false);
                }}
              >
                {TRYB_LABELS[tryb]}
              </button>
            ))}
          </div>
        </div>
        <div className="context-bar-group">
          <span className="context-bar-label">
            Wynik w
            <InfoTooltip text={`${scoreHelp} ${rawScoreHelp}`} />
          </span>
          <div className="segmented" role="group" aria-label="Jednostka wyniku">
            {options.przedstawWynikJako.map((option: PrzedstawWynikJako) => (
              <button
                key={option}
                type="button"
                className={filters.przedstawWynikJako === option ? "active" : ""}
                aria-pressed={filters.przedstawWynikJako === option}
                title={WYNIK_LABELS[option].help}
                onClick={() => {
                  setPrzedstawWynikJako(option);
                  setExpanded(false);
                }}
              >
                {WYNIK_LABELS[option].label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FilterPanel({ variant }: { variant: "field" | "context" }) {
  if (variant === "context") return <ReportContextBar />;

  return (
    <aside className="filter-panel filter-panel-field">
      <div className="filter-panel-header">
        <span>Wybór specjalizacji</span>
      </div>
      <DziedzinaSlicer />
    </aside>
  );
}

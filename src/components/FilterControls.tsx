import { Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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

export function TrybButtonGroup() {
  const trybSzkolenia = useFilterStore((state) => state.filters.trybSzkolenia);
  const setTrybSzkolenia = useFilterStore((state) => state.setTrybSzkolenia);

  return (
    <div className="filter-block">
      <span className="filter-label">Tryb</span>
      <div className="button-group compact">
        {options.tryby.map((tryb: TrybSzkolenia) => (
          <button
            key={tryb}
            className={trybSzkolenia === tryb ? "active" : ""}
            type="button"
            onClick={() => setTrybSzkolenia(tryb)}
          >
            <span>{tryb}</span>
            {tryb === "Rezydencki" ? <InfoTooltip text={doctoralPlacesHelp} /> : null}
          </button>
        ))}
      </div>
    </div>
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

export function PrzedstawWynikJakoControl() {
  const przedstawWynikJako = useFilterStore((state) => state.filters.przedstawWynikJako);
  const setPrzedstawWynikJako = useFilterStore((state) => state.setPrzedstawWynikJako);

  return (
    <div className="filter-block">
      <span className="filter-label">Przedstaw wynik jako</span>
      <div className="button-group result-mode">
        {options.przedstawWynikJako.map((option: PrzedstawWynikJako) => (
          <button
            key={option}
            className={przedstawWynikJako === option ? "active" : ""}
            type="button"
            onClick={() => setPrzedstawWynikJako(option)}
          >
            <span>{option}</span>
            {option === "% punktów rekrutacyjnych (domyślne)" ? (
              <InfoTooltip text={scoreHelp} />
            ) : option === "surowa ilość punktów rekrutacyjnych (poglądowo)" ? (
              <InfoTooltip text={rawScoreHelp} />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FilterPanel({ variant = "all" }: { variant?: "all" | "field" | "secondary" }) {
  return (
    <aside className={`filter-panel filter-panel-${variant}`}>
      <div className="filter-panel-header">
        <span>{variant === "field" ? "Wybór specjalizacji" : "Filtry"}</span>
      </div>
      {variant === "field" ? <DziedzinaSlicer /> : null}
      {variant === "secondary" ? (
        <div className="secondary-filter-grid">
          <TrybButtonGroup />
          <PrzedstawWynikJakoControl />
        </div>
      ) : null}
      {variant === "all" ? (
        <>
          <TrybButtonGroup />
          <PrzedstawWynikJakoControl />
          <DziedzinaSlicer />
        </>
      ) : null}
    </aside>
  );
}

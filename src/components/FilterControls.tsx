import { Search } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getReportOptions } from "../data/reportData";
import { useFilterStore } from "../state/filterStore";
import type { PrzedstawWynikJako, TrybSzkolenia } from "../types";
import { trackEvent } from "../utils/analytics";

const options = getReportOptions();
const scoreHelp =
  "Pamiętaj, że ta wartość to nie procentowy wynik egzaminu końcowego, lecz procent całkowitej liczby punktów rekrutacyjnych (210 dla trybu rezydenckiego, 220 dla pozarezydenckiego).";
const rawScoreHelp = "[Wynik egzaminu + dodatkowe punkty] -wartość przedstawiana dla celów poglądowych, przy założeniu, że nie anulowano żadnego pytania na egzaminie końcowym."
const doctoralPlacesHelp = "Z zestawienia wyłączone są miejsca doktoranckie.";

const TOOLTIP_GAP = 8;
const VIEWPORT_MARGIN = 8;

/**
 * Dymek renderujemy w portalu z position: fixed, bo karty, tabele i kalkulator mają overflow
 * hidden/auto i przycinały treść. Pozycję liczymy od ikony i ograniczamy do okna przeglądarki.
 */
export function InfoTooltip({ text, children }: { text: string; children?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useLayoutEffect(() => {
    if (!visible) {
      setPosition(null);
      return undefined;
    }
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const content = contentRef.current?.getBoundingClientRect();
      if (!trigger || !content) return;
      const fitsAbove = trigger.top - content.height - TOOLTIP_GAP >= VIEWPORT_MARGIN;
      const top = fitsAbove ? trigger.top - content.height - TOOLTIP_GAP : trigger.bottom + TOOLTIP_GAP;
      const centered = trigger.left + trigger.width / 2 - content.width / 2;
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, centered),
        window.innerWidth - content.width - VIEWPORT_MARGIN,
      );
      setPosition({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [visible]);

  return (
    <span
      ref={triggerRef}
      className="info-tooltip"
      tabIndex={0}
      aria-label={text}
      aria-describedby={visible ? tooltipId : undefined}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span style={{ display: "block", lineHeight: 1 }}>?</span>
      {visible &&
        createPortal(
          <span
            ref={contentRef}
            id={tooltipId}
            role="tooltip"
            className="info-tooltip-content"
            // Hidden until measured, so it never flashes at the wrong spot.
            style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            {children ?? text}
          </span>,
          document.body,
        )}
    </span>
  );
}

export function DziedzinaSlicer() {
  const dziedzinaMedycyny = useFilterStore((state) => state.filters.dziedzinaMedycyny);
  const setDziedzinaMedycyny = useFilterStore((state) => state.setDziedzinaMedycyny);
  const [query, setQuery] = useState("");
  const visibleOptions = useMemo(() => filterSpecialties(query), [query]);

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
  Rezydencki: "Rezydencki",
  Pozarezydencki: "Pozarezydencki",
};

const WYNIK_LABELS: Record<PrzedstawWynikJako, { label: string; short: string; help: string }> = {
  "% punktów rekrutacyjnych (domyślne)": { label: "% punktów rekrutacyjnych", short: "% pkt rekr.", help: scoreHelp },
  "surowa ilość punktów rekrutacyjnych (poglądowo)": {
    label: "punkty rekrutacyjne (poglądowo)",
    short: "pkt rekr.",
    help: rawScoreHelp,
  },
};

function filterSpecialties(query: string) {
  const needle = query.toLocaleLowerCase("pl");
  return options.dziedziny.filter((option) => option.toLocaleLowerCase("pl").includes(needle));
}

/** Wybór specjalizacji z wyszukiwarką otwierany w pasku, żeby zmienić ją z dowolnego miejsca strony. */
function SpecialtyPicker({ onPicked }: { onPicked: () => void }) {
  const dziedzinaMedycyny = useFilterStore((state) => state.filters.dziedzinaMedycyny);
  const setDziedzinaMedycyny = useFilterStore((state) => state.setDziedzinaMedycyny);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleOptions = useMemo(() => filterSpecialties(query), [query]);

  // Wpisane frazy (także te bez wyników) pokazują, czego ludzie szukają; wysyłamy po chwili bez pisania.
  useEffect(() => {
    const phrase = query.trim().toLocaleLowerCase("pl");
    if (phrase.length < 3) return undefined;
    const timer = window.setTimeout(() => {
      trackEvent("specialty-search", { query: phrase, results: filterSpecialties(phrase).length });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="context-bar-scope" ref={containerRef}>
      <span className="context-bar-eyebrow">Raport i kalkulator dotyczą</span>
      <button
        type="button"
        className="context-bar-specialty"
        title={`${dziedzinaMedycyny} - kliknij, aby zmienić specjalizację`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setQuery("");
          setOpen((value) => !value);
        }}
      >
        <strong>{dziedzinaMedycyny}</strong>
        <span>zmień</span>
      </button>
      {open && (
        <div className="specialty-popover" role="dialog" aria-label="Wybierz specjalizację">
          <span className="search-input">
            <Search size={15} aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Szukaj specjalizacji"
              type="search"
            />
          </span>
          <div className="slicer-list" role="listbox" aria-label="Specjalizacja">
            {visibleOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={dziedzinaMedycyny === option ? "active" : ""}
                onClick={() => {
                  void setDziedzinaMedycyny(option);
                  setOpen(false);
                  onPicked();
                }}
              >
                {option}
              </button>
            ))}
            {visibleOptions.length === 0 && <span className="specialty-popover-empty">Brak wyników</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Przyklejony pasek mówiący, czego dotyczy raport, z ustawieniami wpływającymi na wszystkie widoki raportu.
 * Obejmuje raport i kalkulator. Na telefonie jest zwinięty do jednej linii i rozwija się po dotknięciu.
 */
export function ReportContextBar() {
  const filters = useFilterStore((state) => state.filters);
  const setTrybSzkolenia = useFilterStore((state) => state.setTrybSzkolenia);
  const setPrzedstawWynikJako = useFilterStore((state) => state.setPrzedstawWynikJako);
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`context-bar ${expanded ? "expanded" : ""}`}
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
        <SpecialtyPicker onPicked={() => setExpanded(false)} />
        <div className="context-bar-group">
          <span className="context-bar-label">
            Tryb
            <InfoTooltip text={doctoralPlacesHelp} />
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
            Pokaż wynik jako
            <InfoTooltip text={`${scoreHelp} ${rawScoreHelp}`} />
          </span>
          <div className="segmented segmented-wrap" role="group" aria-label="Jednostka wyniku">
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

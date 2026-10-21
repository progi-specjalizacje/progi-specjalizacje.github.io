import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { getReportOptions, fetchScoreChoices, type ScoreChoices } from "../data/reportData";
import { useFilterStore } from "../state/filterStore";
import type { TrybSzkolenia } from "../types";
import { formatNumber, formatRecruitmentName } from "../utils/formatters";
import { toDisplayedScore } from "../utils/reportMetrics";

const ALL_ROUNDS = "all";
// Specjalizacje wyłącznie stomatologiczne: nie pokazujemy ich w tej karcie (ani na liście, ani w histogramie),
// chyba że użytkownik wybrał którąś w raporcie – wtedy trafia na dół listy.
const EXCLUDED_SPECIALTIES = new Set([
  "Chirurgia stomatologiczna",
  "Ortodoncja",
  "Periodontologia",
  "Protetyka stomatologiczna",
  "Stomatologia dziecięca",
  "Stomatologia zachowawcza z endodoncją",
]);
const AXIS_FROM = 50;
const TOP_SHOWN = 12;
// Po tylu ms od zapełnienia specjalizacja znika z listy (do tego czasu świeci się na zielono).
const CELEBRATE_MS = 1500;
// Przeskok suwaka o więcej niż tyle p.p. nie jest ruchem ciągłym, więc zapełnione specjalizacje znikają bez animacji.
const JUMP_PP = 4;
// Specjalizacje z napisem „komplet” mogą zajmować co najwyżej tyle listy; nadmiar znika od razu, od najstarszych.
const MAX_CELEBRATING_SHARE = 0.4;
const MAX_CELEBRATING = Math.floor(TOP_SHOWN * MAX_CELEBRATING_SHARE);
// Ranking po wyniku, przy którym zajęte jest tyle miejsc: specjalizacje prawie pełne (np. 56 z 58) nie wypadają za komplet.
const RANK_SHARE = 0.9;
const PLAY_SECONDS = 14;
const IDLE_COLOR = "#e4dbf1";
const ACTIVE_COLOR = "#6843a2";
const FILL_COLOR = "#8c6bc0";
const FULL_COLOR = "#0f766e";
const FOCUS_COLOR = "#b7791f";

const W = 300;
const ROW_H = 30;
const PAD = { top: 14, right: 8, bottom: 14, left: 40 };
// Na wąskich ekranach histogram jest poziomy i niski (100% po lewej, więc suwak jedzie w prawo).
const COMPACT_QUERY = "(max-width: 980px)";
const HW = 360;
const HH = 130;
const HPAD = { top: 30, right: 14, bottom: 22, left: 14 };

interface Race {
  specjalizacja: string;
  places: number;
  total: number;
  median: number;
  /** cum[i] = liczba zakwalifikowanych z wynikiem >= i (p.p.); długość binCount + 1. */
  cum: number[];
  bins: number[];
  /** Wynik (p.p.), od którego miejsca są zapełnione; null, gdy nigdy. */
  fullAt: number | null;
  /** Wynik (p.p.), od którego zajęte jest co najmniej `RANK_SHARE` miejsc; po nim sortujemy. */
  rankAt: number;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

/** Liczba osób z wynikiem >= x, interpolowana liniowo wewnątrz przedziału, żeby ruch był płynny. */
function atLeast(race: { cum: number[]; bins: number[] }, x: number) {
  const index = Math.min(race.bins.length - 1, Math.max(0, Math.floor(x)));
  if (x >= race.bins.length) return 0;
  return race.cum[index] - (x - index) * race.bins[index];
}

export function FillRaceChart() {
  const trybSzkolenia = useFilterStore((state) => state.filters.trybSzkolenia);
  const setTrybSzkolenia = useFilterStore((state) => state.setTrybSzkolenia);
  const focusSpecialty = useFilterStore((state) => state.filters.dziedzinaMedycyny);
  const scoreAsPoints =
    useFilterStore((state) => state.filters.przedstawWynikJako) === "surowa ilość punktów rekrutacyjnych (poglądowo)";
  const [choices, setChoices] = useState<ScoreChoices | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState<string>(() => getReportOptions().rekrutacje[0] ?? ALL_ROUNDS);
  const [cursor, setCursor] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [touched, setTouched] = useState(false);
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia(COMPACT_QUERY).matches);
  // Specjalizacje zapełnione przy bieżącym wyniku: najpierw świecą się na zielono, po chwili znikają z listy.
  const [celebrating, setCelebrating] = useState<Set<string>>(() => new Set());
  const [retired, setRetired] = useState<Set<string>>(() => new Set());
  const prevCursor = useRef(100);
  const timers = useRef(new Map<string, number>());
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId();

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchScoreChoices().then((data) => {
      if (cancelled) return;
      if (data) setChoices(data);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rounds = getReportOptions().rekrutacje;
  const pinnedExcluded = EXCLUDED_SPECIALTIES.has(focusSpecialty) ? focusSpecialty : null;
  const binWidth = choices?.binWidth ?? 1;
  const binCount = Math.round(100 / binWidth);
  const firstBin = Math.round(AXIS_FROM / binWidth);
  const visibleBins = binCount - firstBin;
  const inRound = (rekrutacja: string) => round === ALL_ROUNDS || rekrutacja === round;

  const races = useMemo(() => {
    if (!choices) return [] as Race[];
    const counts = new Map<string, number[]>();
    for (const row of choices.rows) {
      if (row.tryb !== trybSzkolenia || !inRound(row.rekrutacja) || (EXCLUDED_SPECIALTIES.has(row.specjalizacja) && row.specjalizacja !== pinnedExcluded)) continue;
      const bins = counts.get(row.specjalizacja) ?? new Array<number>(binCount).fill(0);
      row.bins.forEach((count, index) => {
        bins[index] += count;
      });
      counts.set(row.specjalizacja, bins);
    }
    const places = new Map<string, number>();
    for (const row of choices.places) {
      if (row.tryb !== trybSzkolenia || !inRound(row.rekrutacja) || (EXCLUDED_SPECIALTIES.has(row.specjalizacja) && row.specjalizacja !== pinnedExcluded)) continue;
      places.set(row.specjalizacja, (places.get(row.specjalizacja) ?? 0) + row.miejsca);
    }

    const result: Race[] = [];
    for (const [specjalizacja, bins] of counts) {
      const capacity = places.get(specjalizacja) ?? 0;
      const total = sum(bins);
      if (capacity <= 0 || total === 0) continue;
      const cum = new Array<number>(binCount + 1).fill(0);
      for (let index = binCount - 1; index >= 0; index -= 1) cum[index] = cum[index + 1] + bins[index];
      let medianBin = binCount - 1;
      for (let index = binCount - 1; index >= 0; index -= 1) {
        if (cum[index] >= total / 2) {
          medianBin = index;
          break;
        }
      }
      let fullAt: number | null = null;
      for (let index = binCount - 1; index >= 0; index -= 1) {
        if (cum[index] >= capacity) {
          fullAt = bins[index] > 0 ? index + (cum[index] - capacity) / bins[index] : index;
          break;
        }
      }
      let rankAt = -1;
      for (let index = binCount - 1; index >= 0; index -= 1) {
        if (cum[index] >= capacity * RANK_SHARE) {
          rankAt = bins[index] > 0 ? index + (cum[index] - capacity * RANK_SHARE) / bins[index] : index;
          break;
        }
      }
      result.push({ specjalizacja, places: capacity, total, median: medianBin, cum, bins, fullAt, rankAt });
    }
    // Najpierw te, które zapełniają się przy najwyższym wyniku (90% miejsc). Kolejność stała podczas ruchu.
    return result.sort((a, b) => b.rankAt - a.rankAt || b.median - a.median);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binCount, choices, pinnedExcluded, round, trybSzkolenia]);

  // Zmiana trybu lub rekrutacji zaczyna wyścig od nowa.
  useEffect(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
    setCelebrating(new Set());
    setRetired(new Set());
  }, [races]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  useEffect(() => {
    const jump = Math.abs(cursor - prevCursor.current) > JUMP_PP;
    prevCursor.current = cursor;
    const celebrate: string[] = [];
    const retire: string[] = [];
    const restore: string[] = [];
    for (const race of races) {
      if (race.fullAt === null) continue;
      const name = race.specjalizacja;
      const tracked = retired.has(name) || celebrating.has(name);
      if (cursor <= race.fullAt) {
        if (!tracked) (jump ? retire : celebrate).push(name);
      } else if (tracked) {
        restore.push(name);
      }
    }
    if (celebrate.length + retire.length + restore.length === 0) return;

    const nextCelebrating = new Set(celebrating);
    const nextRetired = new Set(retired);
    restore.forEach((name) => {
      nextCelebrating.delete(name);
      nextRetired.delete(name);
    });
    retire.forEach((name) => nextRetired.add(name));
    celebrate.forEach((name) => nextCelebrating.add(name));
    // Zbyt wiele „kompletów” naraz (szybki ruch suwaka): najstarsze znikają natychmiast.
    [...nextCelebrating].slice(0, Math.max(0, nextCelebrating.size - MAX_CELEBRATING)).forEach((name) => {
      nextCelebrating.delete(name);
      nextRetired.add(name);
    });

    [...restore, ...retire].forEach((name) => {
      const timer = timers.current.get(name);
      if (timer !== undefined) window.clearTimeout(timer);
      timers.current.delete(name);
    });
    celebrate.forEach((name) => {
      if (!nextCelebrating.has(name)) return;
      timers.current.set(
        name,
        window.setTimeout(() => {
          timers.current.delete(name);
          setCelebrating((current) => {
            const next = new Set(current);
            next.delete(name);
            return next;
          });
          setRetired((current) => new Set(current).add(name));
        }, CELEBRATE_MS),
      );
    });
    // Nadmiarowe, wycofane od razu, nie mogą zostawić działającego timera.
    celebrating.forEach((name) => {
      if (nextCelebrating.has(name)) return;
      const timer = timers.current.get(name);
      if (timer !== undefined) window.clearTimeout(timer);
      timers.current.delete(name);
    });
    setCelebrating(nextCelebrating);
    setRetired(nextRetired);
  }, [celebrating, cursor, races, retired]);

  // Specjalizacja wybrana przez użytkownika jest przypięta (na dole listy, a na wąskich ekranach na górze) i nie znika po zapełnieniu.
  const pinned = races.some((race) => race.specjalizacja === focusSpecialty) ? focusSpecialty : null;
  const queueSlots = pinned ? TOP_SHOWN - 1 : TOP_SHOWN;
  const pinnedSlot = compact ? 0 : TOP_SHOWN - 1;
  const queueStart = pinned && compact ? 1 : 0;
  const queueEnd = queueStart + queueSlots;

  // Lista: pierwsze specjalizacje z kolejki, które jeszcze nie zniknęły. Reszta czeka pod spodem i wjeżdża na dół.
  const slotOf = new Map<string, number>();
  let slot = queueStart;
  for (const race of races) {
    if (race.specjalizacja === pinned) {
      slotOf.set(race.specjalizacja, pinnedSlot);
      continue;
    }
    if (retired.has(race.specjalizacja)) continue;
    slotOf.set(race.specjalizacja, slot);
    slot += 1;
  }

  const binTotals = useMemo(() => {
    const totals = new Array<number>(binCount).fill(0);
    if (!choices) return totals;
    for (const row of choices.rows) {
      if (row.tryb !== trybSzkolenia || !inRound(row.rekrutacja) || EXCLUDED_SPECIALTIES.has(row.specjalizacja)) continue;
      row.bins.forEach((count, index) => {
        totals[index] += count;
      });
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binCount, choices, round, trybSzkolenia]);

  // Płynny ruch kursora podczas odtwarzania: wynik spada ze stałą prędkością.
  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      let reachedEnd = false;
      setCursor((value) => {
        const next = value - (delta * (100 - AXIS_FROM)) / PLAY_SECONDS;
        if (next <= AXIS_FROM) {
          reachedEnd = true;
          return AXIS_FROM;
        }
        return next;
      });
      if (reachedEnd) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const display = (percent: number) => toDisplayedScore(percent, trybSzkolenia, scoreAsPoints);
  const cursorLabel = scoreAsPoints
    ? `≥ ${formatNumber(display(cursor))} pkt`
    : `≥ ${formatNumber(cursor, 1)}%`;
  const allPeople = sum(binTotals);
  const totalsCum = useMemo(() => cumOf(binTotals), [binTotals]);
  const peopleAbove = atLeast({ cum: totalsCum, bins: binTotals }, cursor);
  const nearlyFull = races.filter((race) => atLeast(race, cursor) >= race.places * 0.9).length;

  // --- Geometria pionowego histogramu: wynik na osi pionowej (100% u góry), liczba osób w prawo ---
  const rowCount = TOP_SHOWN;
  const plotH = rowCount * ROW_H;
  const H = plotH + PAD.top + PAD.bottom;
  const chartLeft = PAD.left;
  const chartRight = W - PAD.right;
  const chartTop = PAD.top;
  const chartBottom = PAD.top + plotH;
  const binH = plotH / visibleBins;
  const maxBin = Math.max(1, ...binTotals.slice(firstBin));
  const yOf = (percent: number) => chartTop + ((100 - percent) / (100 - AXIS_FROM)) * plotH;
  const cursorY = yOf(cursor);
  const pillY = Math.min(chartBottom - 11, Math.max(chartTop + 11, cursorY));

  // --- Geometria poziomego histogramu (wąskie ekrany): wynik na osi poziomej (100% po lewej), liczba osób w górę ---
  const hLeft = HPAD.left;
  const hRight = HW - HPAD.right;
  const hTop = HPAD.top;
  const hBottom = HH - HPAD.bottom;
  const hPlotW = hRight - hLeft;
  const hBinW = hPlotW / visibleBins;
  const xOf = (percent: number) => hLeft + ((100 - percent) / (100 - AXIS_FROM)) * hPlotW;
  const cursorX = xOf(cursor);
  const hPillX = Math.min(hRight - 46, Math.max(hLeft + 46, cursorX));

  const moveTo = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (compact) {
      const x = ((clientX - rect.left) / rect.width) * HW;
      const percent = 100 - ((x - hLeft) / hPlotW) * (100 - AXIS_FROM);
      setCursor(Math.min(100, Math.max(AXIS_FROM, percent)));
      return;
    }
    const y = ((clientY - rect.top) / rect.height) * H;
    const percent = 100 - ((y - chartTop) / plotH) * (100 - AXIS_FROM);
    setCursor(Math.min(100, Math.max(AXIS_FROM, percent)));
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    setPlaying(false);
    setTouched(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTo(event.clientX, event.clientY);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (event.buttons & 1) moveTo(event.clientX, event.clientY);
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    // Pionowo: ↓ obniża wynik. Poziomo: → obniża wynik (suwak jedzie w prawo).
    const lower = compact ? "ArrowRight" : "ArrowDown";
    const higher = compact ? "ArrowLeft" : "ArrowUp";
    if (event.key !== lower && event.key !== higher) return;
    event.preventDefault();
    setPlaying(false);
    setTouched(true);
    const step = event.shiftKey ? 5 : 0.5;
    setCursor((value) => Math.min(100, Math.max(AXIS_FROM, value + (event.key === lower ? -step : step))));
  };

  const ticks: number[] = [];
  for (let percent = AXIS_FROM; percent <= 100; percent += 5) ticks.push(percent);

  const roundText = round === ALL_ROUNDS ? "wszystkie rekrutacje łącznie" : formatRecruitmentName(round);

  return (
    <section className="summary-chart choice-chart fill-chart">
      <div className="visual-title">Jak zapełniają się najpopularniejsze specjalizacje</div>
      <div className="chart-toolbar" aria-label="Ustawienia wykresu">
        {(["Rezydencki", "Pozarezydencki"] as TrybSzkolenia[]).map((tryb) => (
          <button
            key={tryb}
            className={trybSzkolenia === tryb ? "active" : ""}
            type="button"
            aria-pressed={trybSzkolenia === tryb}
            onClick={() => setTrybSzkolenia(tryb)}
          >
            {tryb}
          </button>
        ))}
        <label className="choice-round">
          <span>Rekrutacja</span>
          <select value={round} onChange={(event) => setRound(event.target.value)}>
            {rounds.map((option) => (
              <option key={option} value={option}>
                {formatRecruitmentName(option)}
              </option>
            ))}
            <option value={ALL_ROUNDS}>wszystkie łącznie</option>
          </select>
        </label>
      </div>

      {failed && <div className="choice-empty">Nie udało się wczytać danych.</div>}
      {!failed && !choices && <div className="choice-empty">Ładowanie danych...</div>}

      {choices && (
        <div className="choice-main">
          <div className="choice-hist">
            <div className="choice-hist-head">
              <p className="chart-axis-note">
                {compact
                  ? "Przeciągnij suwak na histogramie w prawo, od najwyższych wyników (lub naciśnij ▶), i zobacz, jak kolejne osoby zajmują miejsca na specjalizacjach poniżej."
                  : "Przeciągnij suwak na histogramie w dół, od najwyższych wyników (lub naciśnij ▶), i zobacz, jak kolejne osoby zajmują miejsca na specjalizacjach po prawej. Strzałki ↑ ↓ przesuwają suwak z klawiatury."}
              </p>
              <div className="choice-window-controls">
                <button
                  type="button"
                  className={playing ? "active" : ""}
                  onClick={() => {
                    setTouched(true);
                    if (playing) setPlaying(false);
                    else {
                      if (cursor <= AXIS_FROM + 0.5) setCursor(100);
                      setPlaying(true);
                    }
                  }}
                >
                  {playing ? "■ Stop" : "▶ Odtwórz"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setCursor(100);
                  }}
                >
                  ↺ Od początku
                </button>
              </div>
            </div>
            <p className="choice-summary">
              Osoby z wynikiem <strong>{cursorLabel}</strong> ({roundText}): <strong>{formatNumber(peopleAbove)}</strong>{" "}
              z {formatNumber(allPeople)} zakwalifikowanych. Specjalizacje z zajętymi co najmniej 90% miejsc:{" "}
              <strong>
                {nearlyFull} z {races.length}
              </strong>
              .
            </p>
          </div>

          <div className="fill-layout">
            <div className="fill-hist-col">
              {compact ? (
                <svg
                  ref={svgRef}
                  className="fill-hist-svg compact"
                  viewBox={`0 0 ${HW} ${HH}`}
                  role="slider"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label="Najniższy wynik uwzględniony w zestawieniu"
                  aria-valuemin={AXIS_FROM}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(cursor)}
                  aria-valuetext={cursorLabel}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onKeyDown={onKeyDown}
                >
                  <defs>
                    <clipPath id={clipId}>
                      <rect x={0} y={0} width={Math.max(0, cursorX)} height={HH} />
                    </clipPath>
                  </defs>
                  {[IDLE_COLOR, ACTIVE_COLOR].map((color, layer) => (
                    <g key={color} clipPath={layer === 1 ? `url(#${clipId})` : undefined}>
                      {binTotals.slice(firstBin).map((count, index) => {
                        const bin = firstBin + index;
                        const barH = (count / maxBin) * (hBottom - hTop);
                        return (
                          <rect
                            key={bin}
                            x={xOf((bin + 1) * binWidth) + 0.5}
                            y={hBottom - barH}
                            width={Math.max(1, hBinW - 1)}
                            height={barH}
                            fill={color}
                          />
                        );
                      })}
                    </g>
                  ))}
                  <line x1={hLeft} y1={hBottom} x2={hRight} y2={hBottom} className="chart-axis" />
                  {ticks
                    .filter((percent) => percent % 10 === 0)
                    .map((percent) => (
                      <text key={percent} x={xOf(percent)} y={HH - 6} className="chart-label" textAnchor="middle">
                        {formatNumber(display(percent))}
                      </text>
                    ))}
                  <line x1={cursorX} y1={hTop - 4} x2={cursorX} y2={hBottom + 4} stroke={ACTIVE_COLOR} strokeWidth={2.5} />
                  <g className="fill-handle">
                    <rect x={hPillX - 46} y={0} width={92} height={24} fill={ACTIVE_COLOR} />
                    <text x={hPillX} y={16} className="histogram-badge" textAnchor="middle">
                      {cursorLabel}
                    </text>
                    <rect x={cursorX - 9} y={hBottom - 10} width={18} height={20} fill={ACTIVE_COLOR} />
                    <text x={cursorX} y={hBottom + 4} className="histogram-badge" textAnchor="middle">
                      ⇔
                    </text>
                  </g>
                  {!touched && (
                    <text x={Math.min(hRight - 110, cursorX + 14)} y={hTop + 24} className="fill-hint">
                      przeciągnij w prawo →
                    </text>
                  )}
                </svg>
              ) : (
              <svg
                ref={svgRef}
                className="fill-hist-svg"
                viewBox={`0 0 ${W} ${H}`}
                role="slider"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Najniższy wynik uwzględniony w zestawieniu"
                aria-valuemin={AXIS_FROM}
                aria-valuemax={100}
                aria-valuenow={Math.round(cursor)}
                aria-valuetext={cursorLabel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onKeyDown={onKeyDown}
              >
                <defs>
                  <clipPath id={clipId}>
                    <rect x={0} y={0} width={W} height={Math.max(0, cursorY)} />
                  </clipPath>
                </defs>
                {[IDLE_COLOR, ACTIVE_COLOR].map((color, layer) => (
                  <g key={color} clipPath={layer === 1 ? `url(#${clipId})` : undefined}>
                    {binTotals.slice(firstBin).map((count, index) => {
                      const bin = firstBin + index;
                      const top = yOf((bin + 1) * binWidth);
                      return (
                        <rect
                          key={bin}
                          x={chartLeft}
                          y={top + 0.5}
                          width={(count / maxBin) * (chartRight - chartLeft)}
                          height={Math.max(1, binH - 1)}
                          fill={color}
                        />
                      );
                    })}
                  </g>
                ))}
                <line x1={chartLeft} y1={chartTop} x2={chartLeft} y2={chartBottom} className="chart-axis" />
                {ticks.map((percent) => (
                  <text key={percent} x={chartLeft - 14} y={yOf(percent) + 4} className="chart-label" textAnchor="end">
                    {formatNumber(display(percent))}
                  </text>
                ))}
                <line x1={chartLeft - 4} y1={cursorY} x2={W} y2={cursorY} stroke={ACTIVE_COLOR} strokeWidth={2.5} />
                <g className="fill-handle">
                  <rect x={W - 92} y={pillY - 11} width={92} height={22} fill={ACTIVE_COLOR} />
                  <text x={W - 46} y={pillY + 4} className="histogram-badge" textAnchor="middle">
                    {cursorLabel}
                  </text>
                  <rect x={chartLeft - 10} y={pillY - 11} width={20} height={22} fill={ACTIVE_COLOR} />
                  <text x={chartLeft} y={pillY + 5} className="histogram-badge" textAnchor="middle">
                    ⇕
                  </text>
                </g>
                {!touched && (
                  <text x={chartLeft + 18} y={Math.min(chartBottom - 4, pillY + 34)} className="fill-hint">
                    ↓ przeciągnij w dół
                  </text>
                )}
              </svg>
              )}
              {!compact && (
                <p className="chart-axis-note">
                  Oś pionowa: {scoreAsPoints ? "punkty rekrutacyjne (poglądowo)" : "% maksymalnej punktacji"}. Długość
                  słupka = liczba osób z takim wynikiem.
                </p>
              )}
            </div>

            <div className="fill-rows-col">
              {races.length === 0 ? (
                <div className="choice-empty">Brak danych o miejscach dla tego wyboru.</div>
              ) : (
                <ol className="fill-rows" style={{ height: TOP_SHOWN * ROW_H + 28 }}>
                  {races.map((race) => {
                    const slotIndex = slotOf.get(race.specjalizacja);
                    const gone = slotIndex === undefined;
                    const isPinned = race.specjalizacja === pinned;
                    const hidden = gone || (!isPinned && slotIndex >= queueEnd);
                    const count = atLeast(race, cursor);
                    const ratio = Math.min(1, count / race.places);
                    const full = ratio >= 1 - 1e-9;
                    const isFocus = race.specjalizacja === focusSpecialty;
                    const isCelebrating = celebrating.has(race.specjalizacja);
                    const y = gone ? -1 : isPinned ? slotIndex : Math.min(slotIndex, queueEnd);
                    return (
                      <li
                        key={race.specjalizacja}
                        className={`${isFocus ? "focus" : ""} ${hidden ? "hidden" : ""} ${isCelebrating ? "celebrating" : ""} ${isPinned ? "pinned" : ""}`}
                        style={{ transform: `translateY(${y * ROW_H}px)` }}
                        aria-hidden={hidden}
                        title={
                          race.fullAt === null
                            ? `${race.specjalizacja}: miejsca nie zostały zapełnione (${formatNumber(race.total)} z ${formatNumber(race.places)})`
                            : `${race.specjalizacja}: miejsca zapełnione od wyniku ${scoreAsPoints ? formatNumber(display(race.fullAt)) + " pkt" : formatNumber(race.fullAt, 1) + "%"}`
                        }
                      >
                        <span className="choice-name">{race.specjalizacja}</span>
                        <span className="choice-track fill-track">
                          <i style={{ width: `${ratio * 100}%`, background: full ? FULL_COLOR : isFocus ? FOCUS_COLOR : FILL_COLOR }} />
                        </span>
                        <span className="fill-value">
                          {full ? (
                            <strong style={{ color: FULL_COLOR }}>
                              ✓ komplet
                              <small>
                                {" "}
                                od {race.fullAt === null ? "—" : scoreAsPoints ? `${formatNumber(display(race.fullAt))} pkt` : `${formatNumber(race.fullAt, 1)}%`}
                              </small>
                            </strong>
                          ) : (
                            <>
                              {formatNumber(count)}
                              <small> / {formatNumber(race.places)}</small>
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function cumOf(bins: number[]) {
  const cum = new Array<number>(bins.length + 1).fill(0);
  for (let index = bins.length - 1; index >= 0; index -= 1) cum[index] = cum[index + 1] + bins[index];
  return cum;
}

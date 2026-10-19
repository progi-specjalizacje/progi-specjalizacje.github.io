import { useMemo, useState } from "react";
import { getReportOptions } from "../data/reportData";
import { useFilteredPlaces } from "../hooks/useFilteredPlaces";
import { useFilteredPools } from "../hooks/useFilteredPools";
import { useFilterStore } from "../state/filterStore";
import { formatByType } from "../utils/formatters";
import { getRecruitmentTimeline, summarizeRecruitments, toDisplayedScore } from "../utils/reportMetrics";
import { InfoTooltip } from "./FilterControls";

const width = 920;
const height = 260;
const padding = { top: 24, right: 24, bottom: 44, left: 48 };
const RANGE_COLOR = "#d9cbf0";
const MEDIAN_COLOR = "#6843a2";
const PLACES_COLOR = "#b7791f";
type ChartMode = "points" | "places";

function scale(value: number, min: number, max: number, outputMin: number, outputMax: number) {
  if (max === min) return (outputMin + outputMax) / 2;
  return outputMin + ((value - min) / (max - min)) * (outputMax - outputMin);
}

export function SummaryChart() {
  const [chartMode, setChartMode] = useState<ChartMode>("points");
  const pools = useFilteredPools();
  const places = useFilteredPlaces();
  const trybSzkolenia = useFilterStore((state) => state.filters.trybSzkolenia);
  const przedstawWynikJako = useFilterStore((state) => state.filters.przedstawWynikJako);
  const scoreAsPoints = przedstawWynikJako === "surowa ilość punktów rekrutacyjnych (poglądowo)";
  const upcoming = useMemo(() => getRecruitmentTimeline(pools, places).upcoming, [places, pools]);
  const summaries = useMemo(
    () =>
      // Chronologicznie: najstarsza rekrutacja po lewej, zapowiedziana na końcu.
      summarizeRecruitments(pools, places, [...getReportOptions().rekrutacje].reverse().concat(upcoming ? [upcoming] : [])).map(
        (summary) => ({
          ...summary,
          minThreshold: toDisplayedScore(summary.minThreshold, trybSzkolenia, scoreAsPoints),
          medianThreshold: toDisplayedScore(summary.medianThreshold, trybSzkolenia, scoreAsPoints),
          maxThreshold: toDisplayedScore(summary.maxThreshold, trybSzkolenia, scoreAsPoints),
        }),
      ),
    [places, pools, scoreAsPoints, trybSzkolenia, upcoming],
  );
  const values = summaries
    .flatMap((summary) =>
      chartMode === "points" ? [summary.minThreshold, summary.maxThreshold] : [summary.totalPlaces],
    )
    .filter((value) => Number.isFinite(value));
  const rawMin = values.length > 0 ? Math.min(...values) : 0;
  const rawMax = values.length > 0 ? Math.max(...values) : 1;
  // W trybie progów zostawiamy zapas, żeby słupki rozpiętości nie dotykały osi.
  const domainPadding = chartMode === "points" ? Math.max((rawMax - rawMin) * 0.08, 0.5) : 0;
  const min = rawMin - domainPadding;
  const max = rawMax + domainPadding;
  const chartLeft = padding.left;
  const chartRight = width - padding.right;
  const chartTop = padding.top;
  const chartBottom = height - padding.bottom;
  // Margines z boku, żeby słupki i etykiety skrajnych rekrutacji nie wychodziły poza oś.
  const xFor = (index: number) =>
    scale(index, 0, Math.max(summaries.length - 1, 1), chartLeft + 28, chartRight - 44);

  return (
    <section className="summary-chart">
      <div className="visual-title">Zmiany w czasie</div>
      <div className="chart-toolbar" aria-label="Zakres wykresu">
        <button
          className={chartMode === "points" ? "active" : ""}
          type="button"
          onClick={() => setChartMode("points")}
        >
          Wynik
        </button>
        <button
          className={chartMode === "places" ? "active" : ""}
          type="button"
          onClick={() => setChartMode("places")}
        >
          Ilość miejsc
        </button>
      </div>
      <div className="chart-legend">
        {chartMode === "points" ? (
          <>
            <span>
              <i style={{ background: MEDIAN_COLOR }} />
              Mediana progów województw
            </span>
            <span>
              <i style={{ background: RANGE_COLOR }} />
              Rozpiętość: od najniższego do najwyższego progu
              <InfoTooltip text="Progi liczymy wyłącznie w województwach, w których obsadzono wszystkie oferowane miejsca. Najniższy wynik z niewypełnionej puli nie jest traktowany jako próg konkurencyjny. Najedź na słupek, aby zobaczyć wartości skrajne." />
            </span>
          </>
        ) : (
          <span>
            <i style={{ background: PLACES_COLOR }} />
            Suma miejsc w Polsce
          </span>
        )}
        {chartMode === "points" && (
          <p className="chart-axis-note">
            {scoreAsPoints
              ? "Oś Y: punkty rekrutacyjne (poglądowo; maks. 210 rezydentura / 220 poza rezydenturą)"
              : "Oś Y: % maksymalnej punktacji rekrutacyjnej"}
          </p>
        )}
      </div>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Wykres podsumowania rekrutacji">
          <line x1={chartLeft} y1={chartBottom} x2={chartRight} y2={chartBottom} className="chart-axis" />
          <line x1={chartLeft} y1={chartTop} x2={chartLeft} y2={chartBottom} className="chart-axis" />
          {[0, 0.5, 1].map((tick) => {
            const y = scale(tick, 0, 1, chartBottom, chartTop);
            const value = min + (max - min) * tick;

            return (
              <g key={tick}>
                <line x1={chartLeft} y1={y} x2={chartRight} y2={y} className="chart-grid-line" />
                <text x={chartLeft - 10} y={y + 4} className="chart-tick" textAnchor="end">
                  {chartMode === "points"
                    ? formatByType(value, "score", scoreAsPoints)
                    : formatByType(value, "number")}
                </text>
              </g>
            );
          })}
          {summaries.map((summary, index) => {
            const x = xFor(index);
            return (
              <text key={summary.rekrutacja} x={x} y={height - 15} className="chart-label" textAnchor="middle">
                {summary.rekrutacja}
                {summary.rekrutacja === upcoming && chartMode === "points" ? " (bez wyników)" : ""}
              </text>
            );
          })}
          {chartMode === "points"
            ? summaries.map((summary, index) => {
                if (!Number.isFinite(summary.medianThreshold)) return null;
                const x = xFor(index);
                const yMin = scale(summary.minThreshold, min, max, chartBottom, chartTop);
                const yMax = scale(summary.maxThreshold, min, max, chartBottom, chartTop);
                const yMedian = scale(summary.medianThreshold, min, max, chartBottom, chartTop);
                const formatted = (value: number) => formatByType(value, "score", scoreAsPoints);

                return (
                  <g key={summary.rekrutacja}>
                    <title>
                      {`${summary.rekrutacja}: mediana ${formatted(summary.medianThreshold)}, ` +
                        `od ${formatted(summary.minThreshold)} do ${formatted(summary.maxThreshold)}`}
                    </title>
                    <rect
                      x={x - 9}
                      y={yMax - 4}
                      width={18}
                      height={Math.max(yMin - yMax, 0) + 8}
                      fill={RANGE_COLOR}
                    />
                    <rect x={x - 6} y={yMedian - 6} width={12} height={12} fill={MEDIAN_COLOR} stroke="#ffffff" strokeWidth={2} />
                    <text x={x + 14} y={yMedian + 4} className="chart-point-label" textAnchor="start">
                      {formatted(summary.medianThreshold)}
                    </text>
                  </g>
                );
              })
            : (() => {
                const points = summaries
                  .map((summary, index) =>
                    Number.isFinite(summary.totalPlaces)
                      ? { x: xFor(index), y: scale(summary.totalPlaces, min, max, chartBottom, chartTop), value: summary.totalPlaces }
                      : null,
                  )
                  .filter((point): point is { x: number; y: number; value: number } => point !== null);
                const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
                return (
                  <g>
                    <path d={path} fill="none" stroke={PLACES_COLOR} strokeWidth={3} />
                    {points.map((point) => (
                      <g key={point.x}>
                        <rect x={point.x - 4} y={point.y - 4} width={8} height={8} fill={PLACES_COLOR} />
                        <text x={point.x} y={point.y - 9} className="chart-point-label" textAnchor="middle">
                          {formatByType(point.value, "number")}
                        </text>
                        <title>{`Suma miejsc: ${formatByType(point.value, "number")}`}</title>
                      </g>
                    ))}
                  </g>
                );
              })()}
        </svg>
      </div>
    </section>
  );
}

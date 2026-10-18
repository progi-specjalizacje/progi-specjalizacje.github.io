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
const series = [
  { key: "maxThreshold", label: "Najwyższy próg województwa", color: "#7c3aed", format: "score" },
  { key: "medianThreshold", label: "Mediana progów województw", color: "#0f766e", format: "score" },
  { key: "minThreshold", label: "Najniższy próg województwa", color: "#64748b", format: "score" },
  { key: "totalPlaces", label: "Suma miejsc", color: "#b7791f", format: "number" },
] as const;
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
      summarizeRecruitments(pools, places, [...(upcoming ? [upcoming] : []), ...getReportOptions().rekrutacje]).map(
        (summary) => ({
          ...summary,
          minThreshold: toDisplayedScore(summary.minThreshold, trybSzkolenia, scoreAsPoints),
          medianThreshold: toDisplayedScore(summary.medianThreshold, trybSzkolenia, scoreAsPoints),
          maxThreshold: toDisplayedScore(summary.maxThreshold, trybSzkolenia, scoreAsPoints),
        }),
      ),
    [places, pools, scoreAsPoints, trybSzkolenia, upcoming],
  );
  const visibleSeries =
    chartMode === "points"
      ? series.filter((item) => item.key !== "totalPlaces")
      : series.filter((item) => item.key === "totalPlaces");
  const values = summaries.flatMap((summary) =>
    visibleSeries.map((item) => summary[item.key]).filter((value) => Number.isFinite(value)),
  );
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 1;
  const chartLeft = padding.left;
  const chartRight = width - padding.right;
  const chartTop = padding.top;
  const chartBottom = height - padding.bottom;

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
        {visibleSeries.map((item) => (
          <span key={item.key}>
            <i style={{ background: item.color }} />
            {item.label}
            {item.key === "medianThreshold" && (
              <InfoTooltip text="Progi liczymy wyłącznie w województwach, w których obsadzono wszystkie oferowane miejsca. Najniższy wynik z niewypełnionej puli nie jest traktowany jako próg konkurencyjny." />
            )}
          </span>
        ))}
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
            const x = scale(index, 0, Math.max(summaries.length - 1, 1), chartLeft, chartRight);
            return (
              <text key={summary.rekrutacja} x={x} y={height - 15} className="chart-label" textAnchor="middle">
                {summary.rekrutacja}
                {summary.rekrutacja === upcoming && chartMode === "points" ? " (bez wyników)" : ""}
              </text>
            );
          })}
          {visibleSeries.map((item) => {
            const points = summaries
              .map((summary, index) => {
                const value = summary[item.key];
                if (!Number.isFinite(value)) return null;

                return {
                  x: scale(index, 0, Math.max(summaries.length - 1, 1), chartLeft, chartRight),
                  y: scale(value, min, max, chartBottom, chartTop),
                  value,
                };
              })
              .filter((point): point is { x: number; y: number; value: number } => point !== null);
            const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

            return (
              <g key={item.key}>
                <path d={path} fill="none" stroke={item.color} strokeWidth={item.key === "medianThreshold" || item.key === "totalPlaces" ? 3 : 2} />
                {points.map((point) => (
                  <g key={`${item.key}-${point.x}`}>
                    <circle cx={point.x} cy={point.y} r={4} fill={item.color} />
                    <text
                      x={point.x}
                      y={item.key === "minThreshold" ? point.y + 18 : point.y - 9}
                      className="chart-point-label"
                      textAnchor="middle"
                    >
                      {formatByType(point.value, item.format, scoreAsPoints)}
                    </text>
                    <title>{`${item.label}: ${formatByType(point.value, item.format, scoreAsPoints)}`}</title>
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

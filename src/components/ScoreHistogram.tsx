import { useEffect, useMemo, useState } from "react";
import { getReportOptions } from "../data/reportData";
import { useCalculatorStore } from "../state/calculatorStore";
import { useFilterStore } from "../state/filterStore";
import { formatNumber, formatPercentPoints } from "../utils/formatters";
import { median } from "../utils/reportMetrics";
import { calculateUserPercent } from "../utils/userScore";

const minChartHeight = 130;
const padding = { top: 38, right: 8, bottom: 26, left: 28 };
const binWidthOptions = [0.5, 1, 2, 5];
const maxBins = 24;
// Small samples read better as one dot per person than as bars.
const maxDotPlotSize = 60;
const minDotRadius = 3;
const colors = { below: "#5cbf8e", above: "#d3c4ea", user: "#6843a2" };

interface Bin {
  from: number;
  to: number;
  scores: number[];
}

function quantile(sorted: number[], q: number) {
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const next = sorted[Math.min(sorted.length - 1, base + 1)];
  return sorted[base] + (next - sorted[base]) * (position - base);
}

// Single far-off results (e.g. one near-zero score in an underfilled pool) would flatten the chart,
// so the axis covers only scores inside wide interquartile fences.
function splitOutliers(scores: number[]) {
  const sorted = [...scores].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const fence = Math.max(3 * (q3 - q1), 2);
  const inRange = sorted.filter((score) => score >= q1 - fence && score <= q3 + fence);
  return { inRange, outliers: sorted.length - inRange.length };
}

// Bins depend only on the distribution, so moving the calculator never re-scales the axis.
function buildBins(scores: number[]) {
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const binWidth =
    binWidthOptions.find((width) => (maxScore - minScore) / width <= maxBins) ??
    binWidthOptions[binWidthOptions.length - 1];

  let low = Math.floor(minScore / binWidth) * binWidth;
  let high = Math.floor(maxScore / binWidth) * binWidth + binWidth;
  while ((high - low) / binWidth < 6) {
    low = Math.max(0, low - binWidth);
    high += binWidth;
  }

  const bins: Bin[] = [];
  for (let from = low; from < high - 1e-9; from += binWidth) {
    bins.push({ from, to: from + binWidth, scores: [] });
  }
  scores.forEach((score) => {
    const index = Math.min(bins.length - 1, Math.max(0, Math.floor((score - low) / binWidth + 1e-9)));
    bins[index].scores.push(score);
  });
  bins.forEach((bin) => bin.scores.sort((a, b) => a - b));

  return { bins, low, high, binWidth };
}

// Callback ref, because the plot container mounts only once data has loaded.
function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, size] as const;
}

// Compact distribution embedded in the calculator: always the newest round with data,
// so moving the calculator inputs immediately moves the marker.
export function ScoreHistogram() {
  const specialty = useFilterStore((state) => state.filters.dziedzinaMedycyny);
  const activeData = useFilterStore((state) => state.activeData);
  const calculator = useCalculatorStore();
  const { tryb } = calculator;
  const [plotRef, plotSize] = useElementSize<HTMLDivElement>();
  const plotWidth = plotSize.width;
  // The plot fills whatever height the calculator card leaves free.
  const chartHeight = Math.max(minChartHeight, plotSize.height);

  const userPercent = calculateUserPercent(calculator);

  const specialtyRows = useMemo(
    () =>
      activeData.filter(
        (row) =>
          row.dziedzina_medycyny === specialty &&
          row.tryb_szkolenia === tryb &&
          row.czy_miejsca_doktoranckie !== "TAK",
      ),
    [activeData, specialty, tryb],
  );
  const latestRound = useMemo(() => {
    const present = new Set(specialtyRows.map((row) => row.rekrutacja));
    return getReportOptions().rekrutacje.find((round) => present.has(round)) ?? null;
  }, [specialtyRows]);
  const scores = useMemo(
    () => specialtyRows.filter((row) => row.rekrutacja === latestRound).map((row) => row.punktacja_proc),
    [latestRound, specialtyRows],
  );

  const { inRange, outliers } = useMemo(() => splitOutliers(scores), [scores]);
  const histogram = useMemo(() => (inRange.length > 0 ? buildBins(inRange) : null), [inRange]);
  const atOrBelow = scores.filter((score) => score <= userPercent).length;
  const sharePercent = scores.length > 0 ? (atOrBelow / scores.length) * 100 : 0;

  const width = Math.max(plotWidth, 280);
  const chartLeft = padding.left;
  const chartRight = width - padding.right;
  const chartTop = padding.top;
  const chartBottom = chartHeight - padding.bottom;
  const plotHeight = chartBottom - chartTop;

  const binPixels = histogram ? (chartRight - chartLeft) / histogram.bins.length : 0;
  const maxCount = Math.max(1, ...(histogram?.bins.map((bin) => bin.scores.length) ?? []));
  const dotRadius = Math.min(7, binPixels / 2 - 1, plotHeight / maxCount / 2 - 0.5);
  const useDots = inRange.length <= maxDotPlotSize && dotRadius >= minDotRadius;

  const renderChart = () => {
    if (!histogram) return null;
    const { bins, low, high, binWidth } = histogram;
    const xOf = (value: number) => chartLeft + ((value - low) / (high - low)) * (chartRight - chartLeft);
    const yOf = (count: number) => chartBottom - (count / maxCount) * plotHeight;
    const labelStep = Math.max(1, Math.ceil(44 / binPixels));
    const decimals = binWidth < 1 ? 1 : 0;

    const userOutside = userPercent < low ? "left" : userPercent > high ? "right" : null;
    const userX = Math.min(chartRight, Math.max(chartLeft, xOf(userPercent)));
    const badgeText =
      userOutside === "left"
        ? `← Ty: ${formatPercentPoints(userPercent)}`
        : userOutside === "right"
          ? `Ty: ${formatPercentPoints(userPercent)} →`
          : `Ty: ${formatPercentPoints(userPercent)}`;
    const badgeWidth = badgeText.length * 6.6 + 16;
    // Keep the badge inside the plot while the marker itself follows the score.
    const badgeOffset = Math.min(
      Math.max(-badgeWidth / 2, chartLeft - userX),
      chartRight - userX - badgeWidth,
    );

    return (
      <svg width={width} height={chartHeight} role="img" aria-label="Rozkład wyników zakwalifikowanych">
        {!useDots &&
          [0, 0.5, 1].map((tick) => {
            const value = Math.round(maxCount * tick);
            const y = yOf(value);
            return (
              <g key={tick}>
                <line x1={chartLeft} y1={y} x2={chartRight} y2={y} className="chart-grid-line" />
                <text x={chartLeft - 6} y={y + 4} className="chart-tick" textAnchor="end">
                  {formatNumber(value)}
                </text>
              </g>
            );
          })}
        {bins.map((bin, index) => {
          const x = xOf(bin.from);
          const below = bin.scores.filter((score) => score <= userPercent).length;
          const range = `${formatNumber(bin.from, 1)}–${formatNumber(bin.to, 1)}%`;

          return (
            <g key={bin.from}>
              {useDots ? (
                bin.scores.map((score, dotIndex) => (
                  <circle
                    key={dotIndex}
                    className="histogram-mark"
                    cx={x + binPixels / 2}
                    cy={chartBottom - dotRadius - 1 - dotIndex * dotRadius * 2}
                    r={dotRadius}
                    fill={score <= userPercent ? colors.below : colors.above}
                  >
                    <title>{formatPercentPoints(score)}</title>
                  </circle>
                ))
              ) : bin.scores.length > 0 ? (
                <g>
                  <title>{`${range}: ${bin.scores.length} os.`}</title>
                  <rect
                    className="histogram-mark"
                    x={x + 1}
                    y={yOf(bin.scores.length)}
                    width={Math.max(1, binPixels - 2)}
                    height={chartBottom - yOf(bin.scores.length)}
                    rx={3}
                    fill={colors.above}
                  />
                  <rect
                    className="histogram-mark"
                    x={x + 1}
                    y={yOf(below)}
                    width={Math.max(1, binPixels - 2)}
                    height={chartBottom - yOf(below)}
                    rx={below === bin.scores.length ? 3 : 0}
                    fill={colors.below}
                  />
                </g>
              ) : null}
              {index % labelStep === 0 && (
                <text x={x} y={chartHeight - 10} className="chart-label" textAnchor="middle">
                  {formatNumber(bin.from, decimals)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={chartLeft} y1={chartBottom} x2={chartRight} y2={chartBottom} className="chart-axis" />
        <g className="histogram-user-marker" style={{ transform: `translateX(${userX}px)` }}>
          <line
            x1={0}
            y1={chartTop - 12}
            x2={0}
            y2={chartBottom}
            stroke={colors.user}
            strokeWidth={3}
            strokeDasharray={userOutside ? "3 4" : undefined}
          />
          <circle cx={0} cy={chartBottom} r={5} fill={colors.user} />
          <rect x={badgeOffset} y={chartTop - 36} width={badgeWidth} height={24} rx={12} fill={colors.user} />
          <text x={badgeOffset + badgeWidth / 2} y={chartTop - 20} className="histogram-badge" textAnchor="middle">
            {badgeText}
          </text>
        </g>
      </svg>
    );
  };

  if (!latestRound || scores.length === 0) {
    return (
      <div className="calculator-histogram">
        <span className="histogram-empty">
          Brak zakwalifikowanych dla specjalizacji {specialty} ({tryb}).
        </span>
      </div>
    );
  }

  return (
    <div className="calculator-histogram">
      <div className="calculator-histogram-header">
        <div className="histogram-share">
          <strong>{formatNumber(sharePercent)}%</strong>
          <span>
            zakwalifikowanych miało wynik niższy lub równy Twojemu ({formatNumber(atOrBelow)} z{" "}
            {formatNumber(scores.length)})
          </span>
        </div>
        <span className="histogram-context">
          {specialty} · {latestRound} · cała Polska · mediana {formatPercentPoints(median(scores))}
          {useDots && " · 1 kropka = 1 osoba"}
        </span>
      </div>

      <div className="histogram-plot" ref={plotRef}>
        {plotWidth > 0 && renderChart()}
      </div>

      {outliers > 0 && (
        <div className="histogram-footnote">
          Pominięto {formatNumber(outliers)} {outliers === 1 ? "wynik odstający" : "wyniki odstające"} (są
          uwzględnione w procentach).
        </div>
      )}
    </div>
  );
}

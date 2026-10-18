import { useEffect, useMemo, useState } from "react";
import { type QualifiedEntry, useLatestQualifiedScores } from "../hooks/useLatestQualifiedScores";
import { useCalculatorStore } from "../state/calculatorStore";
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
const colors = { below: "#5cbf8e", bonus: "#f2b544", above: "#d3c4ea", user: "#6843a2" };

interface Bin {
  from: number;
  to: number;
  entries: QualifiedEntry[];
}

function plural(count: number, one: string, few: string, many: string) {
  if (count === 1) return one;
  const lastTwo = count % 100;
  const last = count % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
}

function quantile(sorted: number[], q: number) {
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const next = sorted[Math.min(sorted.length - 1, base + 1)];
  return sorted[base] + (next - sorted[base]) * (position - base);
}

// Single far-off results (e.g. one near-zero score in an underfilled pool) would flatten the chart,
// so the axis covers only scores inside wide interquartile fences.
function splitOutliers(entries: QualifiedEntry[]) {
  const sorted = entries.map((entry) => entry.score).sort((a, b) => a - b);
  if (sorted.length === 0) return { inRange: [], outliers: 0 };
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const fence = Math.max(3 * (q3 - q1), 2);
  const inRange = entries.filter((entry) => entry.score >= q1 - fence && entry.score <= q3 + fence);
  return { inRange, outliers: entries.length - inRange.length };
}

// Bins depend only on the distribution, so moving the calculator never re-scales the axis.
function buildBins(entries: QualifiedEntry[]) {
  const scores = entries.map((entry) => entry.score);
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
    bins.push({ from, to: from + binWidth, entries: [] });
  }
  entries.forEach((entry) => {
    const index = Math.min(bins.length - 1, Math.max(0, Math.floor((entry.score - low) / binWidth + 1e-9)));
    bins[index].entries.push(entry);
  });
  bins.forEach((bin) => bin.entries.sort((a, b) => a.score - b.score));

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
  const calculator = useCalculatorStore();
  const { specialty, tryb, latestRound, entries, poolSummary } = useLatestQualifiedScores();
  const [plotRef, plotSize] = useElementSize<HTMLDivElement>();
  const plotWidth = plotSize.width;
  // The plot fills whatever height the calculator card leaves free.
  const chartHeight = Math.max(minChartHeight, plotSize.height);

  const userPercent = calculateUserPercent(calculator);
  // Exam-only score: the gap to userPercent is what the extra achievements add.
  const basePercent = calculateUserPercent({
    ...calculator,
    hasPhD: false,
    hasExperience: false,
    isAcademicTeacher: false,
    publicationsCount: 0,
  });
  const fillFor = (score: number) =>
    score <= basePercent ? colors.below : score <= userPercent ? colors.bonus : colors.above;

  const { inRange, outliers } = useMemo(() => splitOutliers(entries), [entries]);
  const histogram = useMemo(() => (inRange.length > 0 ? buildBins(inRange) : null), [inRange]);
  // Only fully filled pools had real competition, so the share is computed among them.
  const competitiveScores = entries.filter((entry) => !entry.open).map((entry) => entry.score);
  const atOrBelow = competitiveScores.filter((score) => score <= userPercent).length;
  const sharePercent = competitiveScores.length > 0 ? (atOrBelow / competitiveScores.length) * 100 : 0;
  const allOpen = poolSummary.pools > 0 && poolSummary.openPools === poolSummary.pools;
  const someOpen = poolSummary.openPools > 0 && !allOpen;

  const width = Math.max(plotWidth, 280);
  const chartLeft = padding.left;
  const chartRight = width - padding.right;
  const chartTop = padding.top;
  const chartBottom = chartHeight - padding.bottom;
  const plotHeight = chartBottom - chartTop;

  const binPixels = histogram ? (chartRight - chartLeft) / histogram.bins.length : 0;
  const maxCount = Math.max(1, ...(histogram?.bins.map((bin) => bin.entries.length) ?? []));
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
    const baseX = Math.min(chartRight, Math.max(chartLeft, xOf(basePercent)));
    const hasBonus = userPercent - basePercent > 1e-6 && userX - baseX > 1;
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
          const total = bin.entries.length;
          const below = bin.entries.filter((entry) => entry.score <= basePercent).length;
          const reached = bin.entries.filter((entry) => entry.score <= userPercent).length;
          const openCount = bin.entries.filter((entry) => entry.open).length;
          const columnTop = useDots ? chartBottom - total * dotRadius * 2 - 1 : yOf(total);
          const range = `${formatNumber(bin.from, 1)}–${formatNumber(bin.to, 1)}%`;

          return (
            <g key={bin.from}>
              {useDots ? (
                bin.entries.map((entry, dotIndex) => (
                  <circle
                    key={dotIndex}
                    className="histogram-mark"
                    cx={x + binPixels / 2}
                    cy={chartBottom - dotRadius - 1 - dotIndex * dotRadius * 2}
                    r={dotRadius}
                    fill={fillFor(entry.score)}
                  >
                    <title>
                      {formatPercentPoints(entry.score)}
                      {entry.open ? " · województwo z wolnymi miejscami" : ""}
                    </title>
                  </circle>
                ))
              ) : total > 0 ? (
                <g>
                  <title>
                    {`${range}: ${total} os.`}
                    {openCount > 0 ? ` (w tym ${openCount} z województw z wolnymi miejscami)` : ""}
                  </title>
                  <rect
                    className="histogram-mark"
                    x={x + 1}
                    y={yOf(total)}
                    width={Math.max(1, binPixels - 2)}
                    height={chartBottom - yOf(total)}
                    rx={3}
                    fill={colors.above}
                  />
                  <rect
                    className="histogram-mark"
                    x={x + 1}
                    y={yOf(reached)}
                    width={Math.max(1, binPixels - 2)}
                    height={chartBottom - yOf(reached)}
                    rx={reached === total ? 3 : 0}
                    fill={colors.bonus}
                  />
                  <rect
                    className="histogram-mark"
                    x={x + 1}
                    y={yOf(below)}
                    width={Math.max(1, binPixels - 2)}
                    height={chartBottom - yOf(below)}
                    rx={below === total ? 3 : 0}
                    fill={colors.below}
                  />
                </g>
              ) : null}
              {openCount > 0 && !allOpen && (
                <text x={x + binPixels / 2} y={columnTop - 2} className="histogram-open-mark" textAnchor="middle">
                  *
                  <title>{`${openCount} os. z województw z wolnymi miejscami`}</title>
                </text>
              )}
              {index % labelStep === 0 && (
                <text x={x} y={chartHeight - 10} className="chart-label" textAnchor="middle">
                  {formatNumber(bin.from, decimals)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={chartLeft} y1={chartBottom} x2={chartRight} y2={chartBottom} className="chart-axis" />
        {hasBonus && (
          <g>
            <rect
              className="histogram-bonus-band"
              x={baseX}
              y={chartBottom - 3}
              width={Math.max(0, userX - baseX)}
              height={6}
              rx={3}
              fill={colors.bonus}
            />
            <line
              className="histogram-base-marker"
              x1={baseX}
              y1={chartTop}
              x2={baseX}
              y2={chartBottom}
              stroke={colors.user}
              strokeOpacity={0.45}
              strokeWidth={2}
              strokeDasharray="3 3"
            >
              <title>{`Sam egzamin: ${formatPercentPoints(basePercent)}`}</title>
            </line>
          </g>
        )}
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

  if (!latestRound || entries.length === 0) {
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
      <span className="histogram-context">
        {specialty} · {latestRound} · cała Polska · mediana{" "}
        {formatPercentPoints(median(entries.map((entry) => entry.score)))}
        {useDots && " · 1 kropka = 1 osoba"}
      </span>

      <div className="histogram-plot" ref={plotRef}>
        {plotWidth > 0 && renderChart()}
      </div>

      {allOpen ? (
        <div className="histogram-open-note">
          <span>
            W {latestRound}{" "}
            {poolSummary.freePlaces > 0 ? (
              <>
                {plural(poolSummary.freePlaces, "zostało", "zostały", "zostało")}{" "}
                <strong>
                  {formatNumber(poolSummary.freePlaces)}{" "}
                  {plural(poolSummary.freePlaces, "wolne miejsce", "wolne miejsca", "wolnych miejsc")}
                </strong>{" "}
              </>
            ) : (
              "nie obsadzono wszystkich miejsc "
            )}
            we wszystkich {formatNumber(poolSummary.pools)}{" "}
            {plural(poolSummary.pools, "województwie", "województwach", "województwach")} – każdy chętny dostał
            miejsce, niezależnie od wyniku. Wykres pokazuje wyniki przyjętych, a nie próg.
          </span>
        </div>
      ) : (
        <>
          <div className="histogram-share">
            <strong>{formatNumber(sharePercent)}%</strong>
            <span>
              zakwalifikowanych{someOpen ? " w województwach bez wolnych miejsc" : ""} miało wynik niższy lub równy
              Twojemu ({formatNumber(atOrBelow)} z {formatNumber(competitiveScores.length)})
            </span>
          </div>
          {someOpen && (
            <div className="histogram-open-note compact">
              <span>
                W {formatNumber(poolSummary.openPools)} z {formatNumber(poolSummary.pools)} województw nie obsadzono
                wszystkich miejsc
                {poolSummary.freePlaces > 0 &&
                  ` (łącznie ${plural(poolSummary.freePlaces, "pozostało", "pozostały", "pozostało")} ${formatNumber(
                    poolSummary.freePlaces,
                  )} ${plural(poolSummary.freePlaces, "wolne miejsce", "wolne miejsca", "wolnych miejsc")})`}
                . Oznaczono to <strong className="histogram-open-star">*</strong>
              </span>
            </div>
          )}
        </>
      )}

      {outliers > 0 && (
        <div className="histogram-footnote">
          Pominięto {formatNumber(outliers)} {outliers === 1 ? "wynik odstający" : "wyniki odstające"}
          {allOpen ? "." : " (są uwzględnione w procentach)."}
        </div>
      )}
    </div>
  );
}


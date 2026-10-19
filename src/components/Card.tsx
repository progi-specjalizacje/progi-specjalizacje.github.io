import { useMemo } from "react";
import type { DashboardMetric } from "../types";
import { formatNumber, formatRecruitmentName, formatSignedNumber } from "../utils/formatters";
import { getRecruitmentTimeline, placesFor } from "../utils/reportMetrics";
import { useFilteredPools } from "../hooks/useFilteredPools";
import { useFilteredPlaces } from "../hooks/useFilteredPlaces";
import { InfoTooltip } from "./FilterControls";

interface CardProps {
  /**
   * `{rekrutacja}` zostanie zastąpione nazwą rekrutacji, a `{etap}` informacją,
   * czy to najbliższa (zapowiedziana) czy ostatnia rozstrzygnięta rekrutacja.
   */
  label: string;
  metric: DashboardMetric;
  tooltip?: string;
}

interface RegionPlaces {
  wojewodztwo: string;
  liczba: number;
}

interface CardContent {
  rekrutacja: string | null;
  upcoming: boolean;
  value: string;
  badge?: string;
  trend?: { text: string; tone: "positive" | "negative" | "neutral" };
  context: string;
  regions?: RegionPlaces[];
  regionsWithoutPlaces?: string[];
}

export function Card({ label, tooltip }: CardProps) {
  const pools = useFilteredPools();
  const places = useFilteredPlaces();

  const content = useMemo<CardContent>(() => {
    const timeline = getRecruitmentTimeline(pools, places);

    const rekrutacja = timeline.focus;
    const total = placesFor(places, rekrutacja);
    const previous = placesFor(places, timeline.comparison);
    const byRegion = new Map<string, number>();
    for (const place of places) {
      if (place.rekrutacja !== rekrutacja) continue;
      byRegion.set(place.wojewodztwo, (byRegion.get(place.wojewodztwo) ?? 0) + place.liczba_miejsc);
    }
    const regions = [...byRegion]
      .map(([wojewodztwo, liczba]) => ({ wojewodztwo, liczba }))
      .sort((a, b) => b.liczba - a.liczba || a.wojewodztwo.localeCompare(b.wojewodztwo, "pl"));
    const trend =
      Number.isFinite(total) && Number.isFinite(previous) && timeline.comparison
        ? {
            text: `${formatSignedNumber(total - previous)} vs ${formatRecruitmentName(timeline.comparison)} (${formatNumber(previous)})`,
            tone: (total > previous ? "positive" : total < previous ? "negative" : "neutral") as
              | "positive"
              | "negative"
              | "neutral",
          }
        : undefined;
    return {
      rekrutacja,
      value: Number.isFinite(total) ? formatNumber(total) : "-",
      upcoming: timeline.upcoming !== null,
      badge: timeline.upcoming ? "jeszcze brak wyników rekrutacji" : undefined,
      trend,
      context: timeline.upcoming ? "dostępnych miejsc w Polsce" : "miejsc w Polsce",
      regions: regions.filter((region) => region.liczba > 0),
      regionsWithoutPlaces: regions.filter((region) => region.liczba === 0).map((region) => region.wojewodztwo),
    };
  }, [places, pools]);

  const resolvedLabel = label
    .replace("{etap}", content.upcoming ? "Najbliższa rekrutacja" : "Ostatnia rekrutacja")
    .replace("{rekrutacja}", content.rekrutacja ? formatRecruitmentName(content.rekrutacja) : "-");
  const withoutPlaces = content.regionsWithoutPlaces ?? [];

  return (
    <section className={`kpi-card ${content.regions ? "kpi-card-places" : ""} ${content.upcoming ? "kpi-card-upcoming" : ""}`} aria-label={resolvedLabel}>
      <div className="kpi-label">
        {resolvedLabel}
        {tooltip && <InfoTooltip text={tooltip} />}
        {content.badge && <span className="kpi-badge">{content.badge}</span>}
      </div>
      <div className="kpi-headline">
        <div className="kpi-value">{content.value}</div>
        <div className="kpi-headline-text">
          <div className="kpi-context">{content.context}</div>
          {content.trend && <div className={`kpi-trend ${content.trend.tone}`}>{content.trend.text}</div>}
        </div>
      </div>
      {content.regions && (
        <>
          <ul className="kpi-region-list" aria-label="Miejsca według województw">
            {content.regions.map((region) => (
              <li key={region.wojewodztwo}>
                <span>{region.wojewodztwo}</span>
                <strong>{formatNumber(region.liczba)}</strong>
              </li>
            ))}
          </ul>
          {withoutPlaces.length > 0 && (
            <div className="kpi-region-note">
              Bez miejsc:{" "}
              {withoutPlaces.length <= 3
                ? withoutPlaces.join(", ")
                : `${withoutPlaces.length} ${withoutPlaces.length >= 5 ? "województw" : "województwa"}`}
            </div>
          )}
        </>
      )}
    </section>
  );
}

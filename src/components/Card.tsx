import { useMemo } from "react";
import type { DashboardMetric } from "../types";
import { formatByType, formatNumber, formatRecruitmentName, formatSignedNumber, pluralize } from "../utils/formatters";
import { getRecruitmentTimeline, placesFor, summarizeRecruitment, toDisplayedScore } from "../utils/reportMetrics";
import { useFilteredPools } from "../hooks/useFilteredPools";
import { useFilteredPlaces } from "../hooks/useFilteredPlaces";
import { useFilterStore } from "../state/filterStore";
import { InfoTooltip } from "./FilterControls";

interface CardProps {
  /** `{rekrutacja}` zostanie zastąpione nazwą rekrutacji, której dotyczy kafelek. */
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
  value: string;
  compact?: boolean;
  badge?: string;
  trend?: { text: string; tone: "positive" | "negative" | "neutral" };
  context: string;
  regions?: RegionPlaces[];
  regionsWithoutPlaces?: string[];
}

const PLACE_FORMS: [string, string, string] = ["miejsce", "miejsca", "miejsc"];

export function Card({ label, metric, tooltip }: CardProps) {
  const pools = useFilteredPools();
  const places = useFilteredPlaces();
  const przedstawWynikJako = useFilterStore((state) => state.filters.przedstawWynikJako);
  const trybSzkolenia = useFilterStore((state) => state.filters.trybSzkolenia);
  const scoreAsPoints = przedstawWynikJako === "surowa ilość punktów rekrutacyjnych (poglądowo)";

  const content = useMemo<CardContent>(() => {
    const timeline = getRecruitmentTimeline(pools, places);

    if (metric === "focusPlaces") {
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
        badge: timeline.upcoming ? "wyniki jeszcze nieopublikowane" : "rekrutacja rozstrzygnięta",
        trend,
        context: "miejsc w Polsce",
        regions: regions.filter((region) => region.liczba > 0),
        regionsWithoutPlaces: regions.filter((region) => region.liczba === 0).map((region) => region.wojewodztwo),
      };
    }

    const rekrutacja = timeline.completed[0] ?? null;
    if (!rekrutacja) return { rekrutacja, value: "-", context: "brak rozstrzygniętych rekrutacji" };
    const summary = summarizeRecruitment(pools, places, rekrutacja);

    if (metric === "latestThreshold") {
      if (!Number.isFinite(summary.minThreshold)) {
        return {
          rekrutacja,
          value: "brak progu",
          compact: true,
          context: "wszędzie zostały wolne miejsca",
        };
      }
      const format = (value: number) => formatByType(toDisplayedScore(value, trybSzkolenia, scoreAsPoints), "score", scoreAsPoints);
      const isSingle = summary.minThreshold === summary.maxThreshold;
      return {
        rekrutacja,
        value: isSingle ? format(summary.minThreshold) : `${format(summary.minThreshold)} – ${format(summary.maxThreshold)}`,
        compact: !isSingle,
        context: isSingle ? "w województwach bez wolnych miejsc" : `mediana województw: ${format(summary.medianThreshold)}`,
      };
    }

    if (!Number.isFinite(summary.fillablePlaces)) {
      return { rekrutacja, value: "-", context: "brak danych CMKP o liczbie miejsc" };
    }
    const vacancies = summary.fillablePlaces - summary.filledPlaces;
    return {
      rekrutacja,
      value: `${formatNumber(summary.filledPlaces)} / ${formatNumber(summary.fillablePlaces)}`,
      context:
        vacancies === 0
          ? "wszystkie miejsca obsadzone"
          : `${formatNumber(vacancies)} ${pluralize(vacancies, ["miejsce nieobsadzone", "miejsca nieobsadzone", "miejsc nieobsadzonych"])} w ${formatNumber(summary.regionsWithVacancies)} ${summary.regionsWithVacancies === 1 ? "województwie" : "województwach"}`,
    };
  }, [metric, places, pools, scoreAsPoints, trybSzkolenia]);

  const resolvedLabel = label.replace("{rekrutacja}", content.rekrutacja ? formatRecruitmentName(content.rekrutacja) : "-");
  const withoutPlaces = content.regionsWithoutPlaces ?? [];

  return (
    <section className={`kpi-card ${content.regions ? "kpi-card-places" : ""}`} aria-label={resolvedLabel}>
      <div className="kpi-label">
        {resolvedLabel}
        {tooltip && <InfoTooltip text={tooltip} />}
        {content.badge && <span className="kpi-badge">{content.badge}</span>}
      </div>
      <div className="kpi-headline">
        <div className={`kpi-value ${content.compact ? "compact" : ""}`}>{content.value}</div>
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

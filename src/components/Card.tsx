import { useMemo } from "react";
import type { DashboardMetric } from "../types";
import { formatByType, formatNumber } from "../utils/formatters";
import { summarizeActiveFilters } from "../utils/reportMetrics";
import { useFilteredRows } from "../hooks/useFilteredRows";
import { useFilteredPools } from "../hooks/useFilteredPools";
import { getReportOptions } from "../data/reportData";
import { useFilterStore } from "../state/filterStore";
import { InfoTooltip } from "./FilterControls";

interface CardProps {
  label: string;
  metric: DashboardMetric;
  tooltip?: string;
}

export function Card({ label, metric, tooltip }: CardProps) {
  const rows = useFilteredRows();
  const pools = useFilteredPools();
  const przedstawWynikJako = useFilterStore((state) => state.filters.przedstawWynikJako);
  const dziedzinaMedycyny = useFilterStore((state) => state.filters.dziedzinaMedycyny);
  const trybSzkolenia = useFilterStore((state) => state.filters.trybSzkolenia);
  const scoreAsPoints = przedstawWynikJako === "surowa ilość punktów rekrutacyjnych (poglądowo)";
  const latestRecruitment = useMemo(() => {
    const available = new Set([...rows.map((row) => row.rekrutacja), ...pools.map((pool) => pool.rekrutacja)]);
    return getReportOptions().rekrutacje.find((rekrutacja) => available.has(rekrutacja)) ?? null;
  }, [pools, rows]);
  const latestRows = useMemo(
    () => rows.filter((row) => row.rekrutacja === latestRecruitment),
    [latestRecruitment, rows],
  );
  const latestPools = useMemo(
    () => pools.filter((pool) => pool.rekrutacja === latestRecruitment),
    [latestRecruitment, pools],
  );

  const value = useMemo(() => {
    if (latestRows.length === 0 && latestPools.length === 0) return "-";
    const summary = summarizeActiveFilters(latestRows, latestPools);

    if (metric === "totalPlaces") return Number.isFinite(summary.totalPlaces) ? formatNumber(summary.totalPlaces) : "-";
    return Number.isFinite(summary[metric]) ? formatByType(summary[metric], "score", scoreAsPoints) : "-";
  }, [latestPools, metric, latestRows, scoreAsPoints]);

  const trybFormated = trybSzkolenia === "Rezydencki" ? "rezydenckim" : "pozarezydenckim";
  const rekrutacjaName = latestRecruitment ?? "-";

  return (
    <section className="kpi-card" aria-label={label}>
      <div className="kpi-label">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-context">
        {dziedzinaMedycyny} w trybie {trybFormated} w rekrutacji {rekrutacjaName}
      </div>
    </section>
  );
}

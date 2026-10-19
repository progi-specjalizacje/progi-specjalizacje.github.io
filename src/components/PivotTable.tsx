import { Fragment, useMemo } from "react";
import { getReportOptions } from "../data/reportData";
import { useFilteredPlaces } from "../hooks/useFilteredPlaces";
import { useFilteredPools } from "../hooks/useFilteredPools";
import { useFilterStore } from "../state/filterStore";
import type { PivotConfig, RecruitmentPool } from "../types";
import { interpolateColor } from "../utils/colors";
import { formatByType, formatNumber } from "../utils/formatters";
import { getRecruitmentTimeline } from "../utils/reportMetrics";

interface PivotTableProps {
  config: PivotConfig;
  title?: string;
}

function statusLabel(status: RecruitmentPool["status_konkurencyjnosci"]) {
  if (status === "full") return "Próg konkurencyjny";
  if (status === "underfilled" || status === "no_accepted") return "Wolne miejsca";
  if (status === "inconsistent") return "Sprawdź dane";
  return "Nieustalone";
}

function statusDescription(pool: RecruitmentPool) {
  if (pool.status_konkurencyjnosci === "full") {
    return "Wszystkie oferowane miejsca zostały obsadzone - najniższy wynik jest progiem konkurencyjnym.";
  }
  if (pool.status_konkurencyjnosci === "underfilled") {
    return "Nie wszystkie oferowane miejsca zostały obsadzone. Najniższy wynik zakwalifikowanej osoby nie jest progiem konkurencyjnym.";
  }
  if (pool.status_konkurencyjnosci === "no_accepted") {
    return "Nie zakwalifikowano żadnej osoby, mimo że oferowano miejsca.";
  }
  if (pool.status_konkurencyjnosci === "inconsistent") {
    return "Liczba zakwalifikowanych nie zgadza się z opublikowaną liczbą miejsc. Tej wartości nie traktujemy jako progu.";
  }
  return "Brakuje danych CMKP o liczbie oferowanych miejsc, więc nie można potwierdzić, czy wynik był progiem konkurencyjnym.";
}

function displayedScore(pool: RecruitmentPool, scoreAsPoints: boolean) {
  if (!Number.isFinite(pool.najnizszy_wynik_proc)) return Number.NaN;
  if (!scoreAsPoints) return pool.najnizszy_wynik_proc as number;
  const maximum = pool.tryb_szkolenia === "Rezydencki" ? 210 : 220;
  return Math.round(((pool.najnizszy_wynik_proc as number) / 100) * maximum);
}

function thresholdBackground(pool: RecruitmentPool, fullPools: RecruitmentPool[]) {
  if (pool.status_konkurencyjnosci !== "full" || !Number.isFinite(pool.najnizszy_wynik_proc)) return undefined;
  const values = fullPools
    .map((item) => item.najnizszy_wynik_proc)
    .filter((value): value is number => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (values.length === 0) return undefined;
  if (values[0] === values[values.length - 1]) return interpolateColor("#fff7ed", "#86efac", 0.5);

  const value = pool.najnizszy_wynik_proc as number;
  const lower = values.filter((item) => item < value).length;
  const equal = values.filter((item) => item === value).length;
  const rank = lower + (equal - 1) / 2;
  return interpolateColor("#fff7ed", "#86efac", rank / (values.length - 1));
}

export function PivotTable({ config: _config, title }: PivotTableProps) {
  const pools = useFilteredPools();
  const places = useFilteredPlaces();
  const przedstawWynikJako = useFilterStore((state) => state.filters.przedstawWynikJako);
  const scoreAsPoints = przedstawWynikJako === "surowa ilość punktów rekrutacyjnych (poglądowo)";
  const model = useMemo(() => {
    const upcoming = getRecruitmentTimeline(pools, places).upcoming;
    const upcomingPlaces = new Map(
      places
        .filter((place) => place.rekrutacja === upcoming && place.liczba_miejsc > 0)
        .map((place) => [place.wojewodztwo, place.liczba_miejsc]),
    );
    const rowKeys = [...new Set([...pools.map((pool) => pool.wojewodztwo), ...upcomingPlaces.keys()])].sort((a, b) =>
      a.localeCompare(b, "pl"),
    );
    const columnKeys = [...(upcoming ? [upcoming] : []), ...getReportOptions().rekrutacje];
    const cells = new Map(pools.map((pool) => [`${pool.wojewodztwo}::${pool.rekrutacja}`, pool]));
    const fullPools = pools.filter((pool) => pool.status_konkurencyjnosci === "full");
    return { rowKeys, columnKeys, cells, fullPools, upcoming, upcomingPlaces };
  }, [places, pools]);

  return (
    <section className="pivot-visual">
      {title ? (
        <div className="visual-title">
          {title}
        </div>
      ) : null}
      <div className="pivot-scroll">
        <table className="pivot-table threshold-table">
          <thead>
            <tr>
              <th className="row-heading" rowSpan={2}>Województwo</th>
              {model.columnKeys.map((columnKey, columnIndex) => (
                <th
                  key={columnKey}
                  className={`recruitment-heading pair-${columnIndex % 2 === 0 ? "even" : "odd"}`}
                  colSpan={2}
                >
                  {columnKey}
                  {columnKey === model.upcoming ? " (zapowiedziana)" : ""}
                </th>
              ))}
            </tr>
            <tr>
              {model.columnKeys.map((columnKey, columnIndex) => (
                <Fragment key={columnKey}>
                  <th className={`measure-heading pair-${columnIndex % 2 === 0 ? "even" : "odd"}`}>
                    Próg
                  </th>
                  <th className={`measure-heading pair-${columnIndex % 2 === 0 ? "even" : "odd"} group-end`}>
                    Miejsca
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rowKeys.map((rowKey) => (
              <tr key={rowKey}>
                <th scope="row">{rowKey}</th>
                {model.columnKeys.map((columnKey, columnIndex) => {
                  const pool = model.cells.get(`${rowKey}::${columnKey}`);
                  const pairClass = `pair-${columnIndex % 2 === 0 ? "even" : "odd"}`;
                  if (columnKey === model.upcoming) {
                    const announced = model.upcomingPlaces.get(rowKey);
                    if (!announced) {
                      return (
                        <Fragment key={columnKey}>
                          <td className={`${pairClass} empty-cell upcoming-cell`}>-</td>
                          <td className={`${pairClass} group-end empty-cell upcoming-cell`}>-</td>
                        </Fragment>
                      );
                    }
                    const description = "Wyniki tej rekrutacji nie zostały jeszcze opublikowane. CMKP podało tylko liczbę miejsc.";
                    return (
                      <Fragment key={columnKey}>
                        <td className={`${pairClass} competition-threshold-cell upcoming-cell`} title={description}>
                          <span className="threshold-primary">?</span>
                        </td>
                        <td
                          className={`${pairClass} group-end occupancy-cell upcoming-cell`}
                          title={`${description} Zapowiedziane miejsca: ${announced}.`}
                        >
                          ? / {formatNumber(announced)}
                        </td>
                      </Fragment>
                    );
                  }
                  if (!pool) {
                    return (
                      <Fragment key={columnKey}>
                        <td className={`${pairClass} empty-cell`}>-</td>
                        <td className={`${pairClass} group-end empty-cell`}>-</td>
                      </Fragment>
                    );
                  }

                  const score = displayedScore(pool, scoreAsPoints);
                  const isThreshold = pool.status_konkurencyjnosci === "full";
                  const secondary = Number.isFinite(score)
                    ? `${isThreshold ? "" : "min. przyjęty: "}${formatByType(score, "score", scoreAsPoints)}`
                    : null;
                  const occupancy = `${pool.liczba_zakwalifikowanych} / ${pool.liczba_miejsc ?? "?"}`;

                  return (
                    <Fragment key={columnKey}>
                      <td
                        className={`${pairClass} competition-threshold-cell status-${pool.status_konkurencyjnosci}`}
                        style={{ backgroundColor: thresholdBackground(pool, model.fullPools) }}
                        title={statusDescription(pool)}
                      >
                        <span className="threshold-primary">
                          {isThreshold && Number.isFinite(score)
                            ? formatByType(score, "score", scoreAsPoints)
                            : statusLabel(pool.status_konkurencyjnosci)}
                        </span>
                        {!isThreshold && secondary ? <span className="threshold-secondary">{secondary}</span> : null}
                      </td>
                      <td
                        className={`${pairClass} group-end occupancy-cell status-${pool.status_konkurencyjnosci}`}
                        title={`${statusDescription(pool)} Zakwalifikowani / oferowane miejsca: ${occupancy}.`}
                      >
                        {occupancy}
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

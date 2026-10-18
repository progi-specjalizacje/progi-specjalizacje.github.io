import { useMemo } from "react";
import { getReportOptions } from "../data/reportData";
import { useFilterStore } from "../state/filterStore";
import { useCalculatorStore } from "../state/calculatorStore";
import { theme } from "../styles/theme";
import { calculateUserPercent } from "../utils/userScore";

export function SimulationTable() {
  const globalFilters = useFilterStore((state) => state.filters);
  const activeData = useFilterStore((state) => state.activeData);
  const {
    tryb: calculatorTryb,
    examPoints,
    maxExamPoints,
    hasPhD,
    hasExperience,
    isAcademicTeacher,
    publicationsCount,
    simulationRecruitment,
    setSimulationRecruitment,
  } = useCalculatorStore();

  const options = getReportOptions();

  // Calculate the user's recruitment percentage score
  const userPercent = useMemo(
    () =>
      calculateUserPercent({
        tryb: calculatorTryb,
        examPoints,
        maxExamPoints,
        hasPhD,
        hasExperience,
        isAcademicTeacher,
        publicationsCount,
      }),
    [calculatorTryb, examPoints, maxExamPoints, hasPhD, hasExperience, isAcademicTeacher, publicationsCount],
  );

  // Find all unique voivodeships across the active database to keep the table stable
  const allWojewodztwa = useMemo(() => {
    const regions = activeData.map((row) => row.wojewodztwo);
    return [...new Set(regions)].sort((a, b) => a.localeCompare(b, "pl"));
  }, [activeData]);

  // Filter rows matching: selected recruitment, selected specialization, selected calculator mode, excluding doctoral seats
  const filteredRows = useMemo(() => {
    return activeData.filter(
      (row) =>
        row.rekrutacja === simulationRecruitment &&
        row.dziedzina_medycyny === globalFilters.dziedzinaMedycyny &&
        row.tryb_szkolenia === calculatorTryb &&
        row.czy_miejsca_doktoranckie !== "TAK"
    );
  }, [activeData, simulationRecruitment, globalFilters.dziedzinaMedycyny, calculatorTryb]);

  // Group and count by voivodeship
  const tableData = useMemo(() => {
    const countsMap: Record<string, { lowerOrEqual: number; higher: number }> = {};

    allWojewodztwa.forEach((woj) => {
      countsMap[woj] = { lowerOrEqual: 0, higher: 0 };
    });

    filteredRows.forEach((row) => {
      const score = row.punktacja_proc;
      const woj = row.wojewodztwo;
      if (countsMap[woj]) {
        // Compare candidate percentage vs user percentage
        if (score <= userPercent) {
          countsMap[woj].lowerOrEqual += 1;
        } else {
          countsMap[woj].higher += 1;
        }
      }
    });

    return countsMap;
  }, [allWojewodztwa, filteredRows, userPercent]);

  // Calculate Grand Totals
  const grandTotals = useMemo(() => {
    let lowerOrEqual = 0;
    let higher = 0;

    Object.values(tableData).forEach((counts) => {
      lowerOrEqual += counts.lowerOrEqual;
      higher += counts.higher;
    });

    return { lowerOrEqual, higher };
  }, [tableData]);

  // Render a cell with rules: 0 -> empty, >0 -> colored text
  const renderCell = (value: number, type: "lower" | "higher") => {
    if (value === 0) return "";

    const cellStyle = {
      color: type === "lower" ? theme.colors.green : theme.colors.red,
      fontWeight: 700,
    };

    return <span style={cellStyle}>{value}</span>;
  };

  const hasData = filteredRows.length > 0;

  return (
    <section className="simulation-visual">
      <div className="simulation-header">
        <span>Symulacja szans rekrutacyjnych</span>
        <div className="simulation-filter">
          <label htmlFor="simulation-recruitment-select">Rekrutacja:</label>
          <select
            id="simulation-recruitment-select"
            value={simulationRecruitment}
            onChange={(e) => setSimulationRecruitment(e.target.value)}
          >
            {options.rekrutacje.map((rec) => (
              <option key={rec} value={rec}>
                {rec}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="simulation-info">
        Porównanie Twojego wyniku <strong>({userPercent.toFixed(2)}%)</strong> z wynikami osób zakwalifikowanych dla specjalizacji: <strong>{globalFilters.dziedzinaMedycyny}</strong> ({calculatorTryb})
      </div>

      <div className="pivot-scroll">
        <table className="pivot-table">
          <thead>
            <tr>
              <th className="row-heading">Województwo</th>
              <th style={{ width: "160px", whiteSpace: "normal" }}>Miejsca z wynikiem &le; Twojego</th>
              <th style={{ width: "160px", whiteSpace: "normal" }}>Miejsca z wynikiem wyższym</th>
            </tr>
          </thead>
          <tbody>
            {/* Grand Total Row */}
            <tr className="grand-total-row">
              <th scope="row" style={{ fontWeight: 800 }}>Łącznie</th>
              <td style={{ fontWeight: 800 }}>
                {renderCell(grandTotals.lowerOrEqual, "lower")}
              </td>
              <td style={{ fontWeight: 800 }}>
                {renderCell(grandTotals.higher, "higher")}
              </td>
            </tr>
            {allWojewodztwa.map((woj) => {
              const counts = tableData[woj];
              return (
                <tr key={woj}>
                  <th scope="row">{woj}</th>
                  <td>{renderCell(counts.lowerOrEqual, "lower")}</td>
                  <td>{renderCell(counts.higher, "higher")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!hasData && (
          <div className="no-data-alert">
            Brak danych rekrutacyjnych dla wybranych kryteriów w rundzie {simulationRecruitment}.
          </div>
        )}
      </div>
    </section>
  );
}

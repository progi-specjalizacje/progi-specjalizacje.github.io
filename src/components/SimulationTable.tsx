import { useMemo } from "react";
import { useSimulationScores, useUserScore } from "../hooks/useSimulationScores";
import { useCalculatorStore } from "../state/calculatorStore";
import { theme } from "../styles/theme";

export function SimulationTable() {
  const { userPercent } = useUserScore();
  const { specialty, tryb, rounds, round, regions, entries } = useSimulationScores();
  const setSimulationRecruitment = useCalculatorStore((state) => state.setSimulationRecruitment);

  // Count candidates per voivodeship below/above the user's score; every region stays listed so the table is stable.
  const tableData = useMemo(() => {
    const countsMap: Record<string, { lowerOrEqual: number; higher: number }> = {};
    regions.forEach((woj) => {
      countsMap[woj] = { lowerOrEqual: 0, higher: 0 };
    });
    entries.forEach((entry) => {
      const counts = countsMap[entry.wojewodztwo];
      if (!counts) return;
      if (entry.score <= userPercent) counts.lowerOrEqual += 1;
      else counts.higher += 1;
    });
    return countsMap;
  }, [entries, regions, userPercent]);

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

  const hasData = entries.length > 0;

  return (
    <section className="simulation-visual">
      <div className="simulation-header">
        <span>Symulacja szans rekrutacyjnych</span>
        {round && (
          <div className="simulation-filter">
            <label htmlFor="simulation-recruitment-select">Rekrutacja:</label>
            <select
              id="simulation-recruitment-select"
              value={round}
              onChange={(e) => setSimulationRecruitment(e.target.value)}
            >
              {rounds.map((rec) => (
                <option key={rec} value={rec}>
                  {rec}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="simulation-info">
        Porównanie Twojego wyniku <strong>({userPercent.toFixed(2)}%)</strong> z wynikami osób zakwalifikowanych dla
        specjalizacji: <strong>{specialty}</strong> ({tryb}).
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
            <tr className="grand-total-row">
              <th scope="row" style={{ fontWeight: 800 }}>Łącznie</th>
              <td style={{ fontWeight: 800 }}>{renderCell(grandTotals.lowerOrEqual, "lower")}</td>
              <td style={{ fontWeight: 800 }}>{renderCell(grandTotals.higher, "higher")}</td>
            </tr>
            {regions.map((woj) => {
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
            Brak danych rekrutacyjnych dla wybranych kryteriów{round ? ` w rundzie ${round}` : ""}.
          </div>
        )}
      </div>
    </section>
  );
}

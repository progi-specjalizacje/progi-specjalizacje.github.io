import { useEffect } from "react";
import { SponsorWelcome } from "./components/SponsorWelcome";
import { Card } from "./components/Card";
import { LatestResultsCard } from "./components/LatestResultsCard";
import { FilterPanel } from "./components/FilterControls";
import { PivotTable } from "./components/PivotTable";
import { SummaryChart } from "./components/SummaryChart";
import { FillRaceChart } from "./components/FillRaceChart";
import { TextBox } from "./components/TextBox";
import { Calculator } from "./components/Calculator";
import { SimulationTable } from "./components/SimulationTable";
import { ForecastCard, ForecastIntro } from "./components/ForecastCard";
import { dashboardLayout, type DashboardVisual } from "./config/dashboardLayout";
import { getReportOptions } from "./data/reportData";
import { useFilterStore } from "./state/filterStore";
import { observeSectionViews, trackEvent } from "./utils/analytics";

function specialtySlug(value: string) {
  return value
    .toLocaleLowerCase("pl")
    .replace(/ł/g, "l")
    .replace(/ą/g, "a")
    .replace(/ć/g, "c")
    .replace(/ę/g, "e")
    .replace(/ń/g, "n")
    .replace(/ó/g, "o")
    .replace(/ś/g, "s")
    .replace(/ź/g, "z")
    .replace(/ż/g, "z")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getRequestedSpecialty() {
  const requestedSlug = new URLSearchParams(window.location.search).get("specializacja");
  if (!requestedSlug) return null;
  return getReportOptions().dziedziny.find((specialty) => specialtySlug(specialty) === requestedSlug) ?? null;
}

function gridStyle(visual: DashboardVisual) {
  return {
    gridColumn: `${visual.grid.column} / span ${visual.grid.colSpan}`,
    gridRow: `${visual.grid.row} / span ${visual.grid.rowSpan}`,
  };
}

function renderVisual(visual: DashboardVisual) {
  if (visual.type === "text") {
    return <TextBox {...visual.props} />;
  }

  if (visual.type === "card") {
    return <Card {...visual.props} />;
  }

  if (visual.type === "results") {
    return <LatestResultsCard />;
  }

  if (visual.type === "pivot") {
    return <PivotTable {...visual.props} />;
  }

  if (visual.type === "chart") {
    return <SummaryChart />;
  }

  if (visual.type === "fillChart") {
    return <FillRaceChart />;
  }

  if (visual.type === "calculator") {
    return <Calculator />;
  }

  if (visual.type === "forecastIntro") {
    return <ForecastIntro />;
  }

  if (visual.type === "forecast") {
    return <ForecastCard />;
  }

  if (visual.type === "simulation") {
    return <SimulationTable />;
  }

  return <FilterPanel {...visual.props} />;
}

function DashboardApp() {
  const isLoading = useFilterStore((state) => state.isLoading);
  const loadSpecialtyData = useFilterStore((state) => state.loadSpecialtyData);
  const setDziedzinaMedycyny = useFilterStore((state) => state.setDziedzinaMedycyny);

  useEffect(() => {
    const initializeReport = async () => {
      const currentSpecialty = useFilterStore.getState().filters.dziedzinaMedycyny;
      const requestedSpecialty = getRequestedSpecialty();
      trackEvent("specialty-landing", {
        value: requestedSpecialty ?? currentSpecialty,
        source: requestedSpecialty ? "url" : "default",
      });
      if (requestedSpecialty && requestedSpecialty !== currentSpecialty) {
        await setDziedzinaMedycyny(requestedSpecialty, { silent: true });
      } else {
        await loadSpecialtyData(currentSpecialty);
      }

      const targetId = window.location.hash.slice(1);
      if (targetId) {
        window.requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView());
      }
    };

    void initializeReport();
  }, [loadSpecialtyData, setDziedzinaMedycyny]);

  useEffect(() => {
    observeSectionViews({
      "#raport": "raport",
      "#kalkulator": "kalkulator",
      ".seo-faq": "faq",
    });
  }, []);

  return (
    <>
    <SponsorWelcome />
    <main className="dashboard-shell" id="progi">
      {isLoading && (
        <div className="loading-overlay" aria-live="polite">
          <div className="spinner" />
          <span>Ładowanie danych...</span>
        </div>
      )}
      <div className={`dashboard-grid ${isLoading ? "loading" : ""}`}>
        {dashboardLayout.map((visual) => (
          <div
            key={visual.id}
            id={visual.id === "pivot" ? "raport" : visual.id === "calculator" ? "kalkulator" : visual.id}
            className={`dashboard-item visual-${visual.type} item-${visual.id}`}
            style={gridStyle(visual)}
          >
            {renderVisual(visual)}
          </div>
        ))}
      </div>
    </main>
    </>
  );
}

export default function App() {
  return <DashboardApp />;
}

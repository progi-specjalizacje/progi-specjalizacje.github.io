import type { DashboardMetric, PivotConfig, TextVariant } from "../types";

type VisualType = "text" | "card" | "pivot" | "filters" | "chart" | "calculator" | "simulation";

interface GridPosition {
  column: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

interface BaseVisual {
  id: string;
  type: VisualType;
  grid: GridPosition;
}

export interface TextVisual extends BaseVisual {
  type: "text";
  props: {
    text: string;
    variant: TextVariant;
  };
}

export interface CardVisual extends BaseVisual {
  type: "card";
  props: {
    label: string;
    metric: DashboardMetric;
    tooltip?: string;
  };
}

export interface PivotVisual extends BaseVisual {
  type: "pivot";
  props: {
    title: string;
    config: PivotConfig;
  };
}

export interface FilterVisual extends BaseVisual {
  type: "filters";
  props: {
    variant: "field" | "secondary";
  };
}

export interface ChartVisual extends BaseVisual {
  type: "chart";
}

export interface CalculatorVisual extends BaseVisual {
  type: "calculator";
}

export interface SimulationVisual extends BaseVisual {
  type: "simulation";
}

export type DashboardVisual =
  | TextVisual
  | CardVisual
  | PivotVisual
  | FilterVisual
  | ChartVisual
  | CalculatorVisual
  | SimulationVisual;

export const dashboardLayout: DashboardVisual[] = [
  {
    id: "title",
    type: "text",
    grid: { column: 1, row: 1, colSpan: 12, rowSpan: 1 },
    props: {
      text: "Progi na specjalizacje lekarskie i stomatologiczne",
      variant: "title",
    },
  },
  {
    id: "subtitle",
    type: "text",
    grid: { column: 1, row: 2, colSpan: 12, rowSpan: 1 },
    props: {
      text: `<strong>Porównaj progi punktowe, liczbę miejsc i wyniki rekrutacji na specjalizacje lekarskie i lekarsko-dentystyczne według województw, lat oraz trybu szkolenia.</strong>`,
      variant: "body",
    },
  },
  {
    id: "field-filter",
    type: "filters",
    grid: { column: 1, row: 3, colSpan: 3, rowSpan: 4 },
    props: { variant: "field" },
  },
  {
    id: "average-threshold-card",
    type: "card",
    grid: { column: 4, row: 3, colSpan: 3, rowSpan: 2 },
    props: {
      label: "Uśredniony próg dla wszystkich województw",
      metric: "averageThreshold",
      tooltip: "Średnia obejmuje wyłącznie województwa, w których obsadzono wszystkie oferowane miejsca. Najniższy wynik z niewypełnionej puli nie jest traktowany jako próg konkurencyjny.",
    },
  },
  {
    id: "median-qualified-score-card",
    type: "card",
    grid: { column: 7, row: 3, colSpan: 3, rowSpan: 2 },
    props: {
      label: "Średni wynik wszystkich zakwalifikowanych",
      metric: "medianQualifiedScore",
    },
  },
  {
    id: "total-places-card",
    type: "card",
    grid: { column: 10, row: 3, colSpan: 3, rowSpan: 2 },
    props: {
      label: "Liczba oferowanych miejsc w Polsce",
      metric: "totalPlaces",
    },
  },
  {
    id: "secondary-filters",
    type: "filters",
    grid: { column: 4, row: 5, colSpan: 9, rowSpan: 2 },
    props: { variant: "secondary" },
  },
  {
    id: "pivot",
    type: "pivot",
    grid: { column: 1, row: 7, colSpan: 12, rowSpan: 8 },
    props: {
      title: "Szczegółowy próg konkurencyjny i obsada miejsc",
      config: {
        rows: ["wojewodztwo"],
        columns: ["rekrutacja"],
        values: [
          { field: "wynik_proc_lub_punkty", aggregation: "min", label: "Min wynik", format: "score" },
          {
            field: "ilosc_zakwalifikowanych_w_trybie",
            aggregation: "median",
            label: "Il. zakwalifikowanych",
            format: "number",
          },
        ],
        conditionalFormats: [
          { valueLabel: "Min wynik", type: "colorScale", from: "#fff7ed", to: "#86efac" },
          { valueLabel: "Il. zakwalifikowanych", type: "colorScale", from: "#eef2ff", to: "#7dd3fc" },
        ],
      },
    },
  },
  {
    id: "summary-chart",
    type: "chart",
    grid: { column: 1, row: 15, colSpan: 12, rowSpan: 5 },
  },
  {
    id: "calculator-section-title",
    type: "text",
    grid: { column: 1, row: 20, colSpan: 12, rowSpan: 1 },
    props: {
      text: "Kalkulator punktów rekrutacyjnych i symulacja szans",
      variant: "heading1",
    },
  },
  {
    id: "calculator",
    type: "calculator",
    grid: { column: 1, row: 21, colSpan: 7, rowSpan: 10 },
  },
  {
    id: "simulation",
    type: "simulation",
    grid: { column: 8, row: 21, colSpan: 5, rowSpan: 10 },
  },
];

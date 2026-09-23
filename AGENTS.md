# Agent Guide

This repo contains a client-only React + TypeScript dashboard and a local modeling pipeline for Polish medical residency recruitment data. The application remains backend-free; prediction datasets, backtests, and forecasts are generated locally from CSV/PDF-derived sources.

## Quick Commands

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run prediction:data
npm run prediction:scope
npm run prediction:model
npm run prediction:download-facility-pilot
npm run prediction:facility-pilot
```

The dev server defaults to `http://127.0.0.1:5173/`.

## Project Map

- `src/App.tsx` renders the configured dashboard visuals into the CSS grid.
- `src/config/dashboardLayout.ts` is the first place to change page arrangement, visual selection, KPI definitions, and pivot config.
- `source_data/` contains parsed CSV files for recruitment rounds such as `w-2026` and `j-2025`.
- `src/data/sourceCsv.ts` imports the source CSV files as raw text.
- `src/data/reportData.ts` parses CSV rows, normalizes Polish headers, exposes report options, and applies filters. Keep components importing through this layer rather than importing raw CSV directly.
- `src/state/filterStore.ts` owns global report filters in Zustand.
- `src/hooks/useFilteredRows.ts` applies the global filters and is the common subscription path for visuals.
- `src/components/` contains reusable report visuals and filter controls.
- `src/styles/theme.ts` owns shared text variants and color tokens.
- `src/styles/global.css` owns page, grid, control, KPI, and pivot visual styling.
- `src/types.ts` owns shared domain, filter, visual, and pivot types.
- `cmkp_wyniki_parse/` is the independent PDF-to-CSV parser supplied with the project. Its own `AGENTS.md` applies inside that directory.
- `prediction/README.md` documents prediction scope, data definitions, model targets, validation, outputs, and limitations.
- `prediction/data/` contains generated modeling datasets, rolling-origin backtests, and forecasts. Do not edit generated CSV/JSON outputs by hand.
- `prediction/sources/` contains locally retained source material used by the prediction pipeline.
- `scripts/buildPredictionDataset.js` joins parsed recruitment results, CMKP places, and CEM statistics into the modeling dataset.
- `scripts/analyzePredictionScope.js` assigns transparent pilot/scope groups from historical data.
- `scripts/trainThresholdModel.js` trains and evaluates the regional threshold model, the national aggregation variants, and the separate fill-probability model.
- `scripts/downloadCmkpPlaces.js` and `scripts/parse_cmkp_places.py` obtain and parse official CMKP place lists.
- `scripts/downloadCmkpFacilityPilot.js` and `scripts/parse_cmkp_facility_pilot.py` run the isolated facility/address extraction pilot documented in `prediction/README.md`; its outputs are not production model inputs.

## Architecture Rules

- Keep the app backend-free. Use local CSV data and browser memory only unless the user explicitly asks for an integration.
- Preserve the `getReportData()` abstraction so the source can change later without changing component code.
- Add new filters to `ReportFilters`, `filterStore.ts`, `applyReportFilters()`, and the filter UI together.
- When adding new CSV files, import them in `src/data/sourceCsv.ts`.
- Add new visual types by extending `DashboardVisual` in `dashboardLayout.ts`, then update `renderVisual()` in `App.tsx`.
- Keep layout changes in `dashboardLayout.ts`; avoid hard-coding positions inside components.
- Keep TextBox style variants in `theme.ts` so typography stays consistent.
- Use shared formatters in `src/utils/formatters.ts` for displayed numbers, currency, and percentages.
- Keep threshold prediction and fill prediction as separate targets. A minimum accepted score from an incompletely filled pool is not a competitive threshold.
- Preserve rolling-origin validation: a historical round may use only information available before that round. Never derive predictors or selection groups from the test round's outcomes.
- Match medical specialties to LEK and dental specialties to LDEK. Continue excluding mixed-path specialties unless the modeling scope is explicitly expanded.
- The fill model intentionally does not use LEK/LDEK statistics. Its current production probability is the raw ridge-logistic output; experimental post-hoc calibration remains diagnostic because it worsened rolling-origin Brier score and calibration error.
- Regenerate prediction outputs through the npm scripts. When changing features, targets, calibration, or output columns, update `prediction/README.md` and `prediction/data/threshold_model_report.json` through the training script.
- Keep provincial facility-list capacity separate from the aggregate resident/non-resident allocation. The pilot field `liczba_wolnych_miejsc` is available training capacity until source reconciliation proves a narrower interpretation.

## Verification Checklist

Before handing off changes:

```bash
npm run typecheck
npm run build
```

For prediction changes, also run the affected pipeline stages. A model-only change normally requires:

```bash
npm run prediction:model
```

Confirm that generated probabilities are finite and within `[0, 1]`, backtest rows remain chronological, and the selected production variant is not worse than a retained baseline on its stated metric.

For UI changes, also run `npm run dev` and verify:

- KPI values render.
- Filters change KPI and pivot values.
- The pivot table scrolls without header/body overlap.
- The layout remains usable below `980px` width.

## Notes For Future Agents

- Do not edit generated files in `dist/` or `node_modules/`.
- There are currently no automated unit tests. Use `typecheck` and `build` as the minimum application validation, plus rolling-origin backtest metrics for prediction changes.
- The current pivot is `wojewodztwo` by `rekrutacja`, with minimum `punktacja_proc` and median `ilosc_zakwalifikowanych_w_trybie`.
- The visual design is intentionally dashboard-like: dense, calm, and operational rather than a marketing landing page.

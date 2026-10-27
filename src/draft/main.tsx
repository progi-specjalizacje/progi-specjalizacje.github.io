// Robocza strona do pracy nad wizualizacją prognozy (prognoza-szkic.html). Do usunięcia razem z katalogiem src/draft.
import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/global.css";
import "./draft.css";
import { ForecastDraft } from "./ForecastDraft";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ForecastDraft />
  </React.StrictMode>,
);

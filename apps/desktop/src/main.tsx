import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { captureGlobalErrors } from "./lib/diagnostics";
import "./styles.css";

// Local diagnostic capture (Phase 46 §7): unhandled errors land in the
// redacting log buffer, from which the writer can export a bundle. Nothing
// is sent anywhere.
captureGlobalErrors();

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root not found.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/**
 * Component gallery entry (S24, O-267): built only with `vite build --mode harness`, never in the
 * production image. The screenshot step fills it with every component; until then it only
 * proves the harness build works.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("gallery: no #root element");

createRoot(container).render(
  <StrictMode>
    <h1>Component gallery</h1>
  </StrictMode>,
);

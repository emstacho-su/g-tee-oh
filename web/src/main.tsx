/**
 * Browser entry point for the web single-page app (R0.7). index.html loads this module, which
 * mounts the router into the #root element. The router itself lives in router.tsx so the
 * vitest suite can build it with a memory history instead of the browser one.
 */
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createAppRouter } from "./router.js";
import "./styles.css";

const MOUNT_ELEMENT_ID = "root";

const container = document.getElementById(MOUNT_ELEMENT_ID);
if (container === null) {
  throw new Error(`web: index.html has no element with id "${MOUNT_ELEMENT_ID}" to mount into`);
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
);

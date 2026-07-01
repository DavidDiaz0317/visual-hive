import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/app.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Visual Hive Control Plane root element is missing.");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

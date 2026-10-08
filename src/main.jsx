import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PatternReader } from "./pages/pattern-reader/PatternReader.jsx";
import "./pages/pattern-reader/PatternReader.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <PatternReader />
  </StrictMode>,
);

import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Landing from "./Landing.jsx";
import Pay from "./Pay.jsx";
import Run from "./Run.jsx";

const path = location.pathname;
const runId = path.match(/^\/run\/([0-9a-f]{12})$/)?.[1];
const page = runId ? <Run id={runId} /> : path === "/pay" ? <Pay /> : <Landing />;

createRoot(document.getElementById("root")).render(<StrictMode>{page}</StrictMode>);

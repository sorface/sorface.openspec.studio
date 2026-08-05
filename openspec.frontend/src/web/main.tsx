import React from "react";
import { createRoot } from "react-dom/client";
import { OpenSpecWorkspace } from "@/features/workspace/components/OpenSpecWorkspace";
import "@/app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element is missing");
}

createRoot(root).render(
  <React.StrictMode>
    <OpenSpecWorkspace />
  </React.StrictMode>,
);

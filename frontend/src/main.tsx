import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ChatProvider } from "./contexts/ChatContext";
import { Landing } from "./pages/Landing";
import { DaasPage } from "./pages/DaasPage";

// Attrition's own Convex deployment (daas domain).
// Override via VITE_CONVEX_URL if running against dev deployment.
const CONVEX_URL =
  (import.meta.env.VITE_CONVEX_URL as string | undefined) ||
  "https://joyous-walrus-428.convex.cloud";
const convex = new ConvexReactClient(CONVEX_URL);
import { Dashboard } from "./pages/Dashboard";
import { Results } from "./pages/Results";
import { Sitemap } from "./pages/Sitemap";
import { Audit } from "./pages/Audit";
import { Workflows } from "./pages/Workflows";
import { Distill } from "./pages/Distill";
import { Judge } from "./pages/Judge";
import { Compare } from "./pages/Compare";
import { Benchmark } from "./pages/Benchmark";
import { RunAnatomy } from "./pages/RunAnatomy";
import { Proof } from "./pages/Proof";
import { Improvements } from "./pages/Improvements";
import { Live } from "./pages/Live";
import { GetStarted } from "./pages/GetStarted";
import { ScanResult } from "./pages/ScanResult";
import { Docs } from "./pages/Docs";
import { AdvisorDashboard } from "./pages/AdvisorDashboard";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <ChatProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/daas" element={<DaasPage />} />
          <Route path="/scan/:id" element={<ScanResult />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/live" element={<Live />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/distill/:id" element={<Distill />} />
          <Route path="/judge" element={<Judge />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/anatomy" element={<RunAnatomy />} />
          <Route path="/benchmark" element={<Benchmark />} />
          <Route path="/proof" element={<Proof />} />
          <Route path="/improvements" element={<Improvements />} />
          <Route path="/get-started" element={<GetStarted />} />
          <Route path="/advisor" element={<AdvisorDashboard />} />
          {/* Legacy QA routes (kept for backward compatibility) */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/results/:id" element={<Results />} />
          <Route path="/sitemap" element={<Sitemap />} />
          <Route path="/audit" element={<Audit />} />
          </Routes>
        </ChatProvider>
      </BrowserRouter>
    </ConvexProvider>
  </React.StrictMode>,
);

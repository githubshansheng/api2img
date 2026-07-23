import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { detectClientPlatform } from "./services/client-platform-service";
import { installFrontendDebugLogging } from "./services/debug-log-service";
import "./styles.css";

const navigatorWithClientHints = navigator as Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

document.documentElement.dataset.platform = detectClientPlatform(
  navigatorWithClientHints
);
installFrontendDebugLogging();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

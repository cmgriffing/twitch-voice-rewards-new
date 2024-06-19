import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.bak.tsx";
import { H } from "highlight.run";
import { ErrorBoundary } from "@highlight-run/react";

H.init("lgxrjr4g", {
  serviceName: "frontend-app",
  tracingOrigins: true,
  networkRecording: {
    enabled: true,
    recordHeadersAndBody: true,
    urlBlocklist: [],
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

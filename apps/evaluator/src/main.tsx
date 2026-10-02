import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/700.css";
import "./styles.css";
import { App } from "./App";

// Ask the browser to keep this app's data even under storage pressure
// (unsent grades live here until they reach the relay).
void navigator.storage?.persist?.();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

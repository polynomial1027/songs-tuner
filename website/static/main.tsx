import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DownloadPage from "../app/download/page";
import "../app/globals.css";
import Home from "../app/page";

const isDownload = window.location.pathname.replace(/\/$/, "").endsWith("/download");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isDownload ? <DownloadPage /> : <Home />}</StrictMode>,
);

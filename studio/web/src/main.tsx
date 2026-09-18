import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "@/app/router";
import "./index.css";

// template fonts — biar thumb sesuai template, bukan Inter semua
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/lora";
import "@fontsource/bebas-neue";
import "@fontsource/anton";
import "@fontsource/righteous";
import "@fontsource/bungee";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/caveat";
import "@fontsource/poppins";
import "@fontsource/lobster";
import "@fontsource-variable/montserrat";
import "@fontsource/vt323";

const root = document.getElementById("root");
if (!root) throw new Error("Root not found");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

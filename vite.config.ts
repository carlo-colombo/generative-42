import { defineConfig } from "vite";
import { pwaShellPlugin } from "./vite-plugin-pwa-shell";

// Extra Host names for testing over a tunnel or another machine. Quick tunnels
// get a fresh subdomain on every run, so trycloudflare is allowed as a suffix.
const allowedHosts = [
  ".trycloudflare.com",
  ...(process.env.VITE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
];

// GitHub Pages serves a project site from /<repo>/, so the deployment base is
// configurable. Every app URL is built from import.meta.env.BASE_URL (see
// src/paths.ts) and the service worker gets the same base injected.
function normalizeBase(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  const path = trimmed.replace(/^\/+|\/+$/g, "");
  return path ? `/${path}/` : "/";
}

export default defineConfig({
  base: normalizeBase(process.env.VITE_BASE),
  plugins: [pwaShellPlugin()],
  server: {
    host: "0.0.0.0",
    open: true,
    allowedHosts,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts,
  },
  build: {
    outDir: "dist",
    assetsDir: "app",
    assetsInlineLimit: 0,
  },
});

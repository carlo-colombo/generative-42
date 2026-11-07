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

export default defineConfig({
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

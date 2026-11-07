import { defineConfig } from "vite";
import { pwaShellPlugin } from "./vite-plugin-pwa-shell";

export default defineConfig({
  plugins: [pwaShellPlugin()],
  server: {
    host: "0.0.0.0",
    open: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  build: {
    outDir: "dist",
    assetsDir: "app",
    assetsInlineLimit: 0,
  },
});

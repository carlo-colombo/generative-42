import { defineConfig } from "vite";

export default defineConfig({
  server: {
    open: true,
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
  },
});

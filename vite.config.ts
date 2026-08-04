import { defineConfig, type Plugin } from "vite";
import { readdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function assetManifestPlugin(): Plugin {
  const assetsDir = resolve(__dirname, "public/assets");
  const manifestPath = resolve(assetsDir, "manifest.json");
  const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

  const update = () => {
    const files = readdirSync(assetsDir)
      .filter((f) => IMAGE_RE.test(f))
      .sort();
    writeFileSync(manifestPath, JSON.stringify(files, null, 2));
  };

  return {
    name: "asset-manifest",
    configResolved() {
      update();
    },
    configureServer(server) {
      server.watcher.on("add", (file) => {
        if (file.startsWith(assetsDir)) update();
      });
      server.watcher.on("unlink", (file) => {
        if (file.startsWith(assetsDir)) update();
      });
    },
  };
}

export default defineConfig({
  plugins: [assetManifestPlugin()],
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

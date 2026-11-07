import type { Plugin } from "vite";
import type { ServerResponse } from "http";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
const FONT_RE = /\.ttf$/i;
const APP_ASSET_RE = /^app\/.*\.(js|css)$/;

const ICON_URLS = ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];

function renderServiceWorker(template: string, buildId: string, base: string, precache: string[]): string {
  const source = template
    .replace('"__BUILD_ID__"', JSON.stringify(buildId))
    .replace('"__BASE__"', JSON.stringify(base))
    .replace("__PRECACHE_URLS__", JSON.stringify(precache, null, 2));
  if (source.includes("__PRECACHE_URLS__") || source.includes("__BUILD_ID__") || source.includes("__BASE__")) {
    throw new Error("public/sw.js template placeholders were not substituted");
  }
  return source;
}

export function pwaShellPlugin(): Plugin {
  // Computed once per config load so sw.js and the app agree on one shell name.
  const buildId = Date.now().toString(36);
  let base = "/";
  let publicDir = "";
  let assets: string[] = [];

  function appUrl(path: string): string {
    return `${base}${path.replace(/^\/+/, "")}`;
  }

  function readAssetManifest(): string[] {
    // public/assets is tracked only by .gitkeep: no source images ship with the
    // repository, so a fresh clone has nothing to list.
    const dir = resolve(publicDir, "assets");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => IMAGE_RE.test(file))
      .sort();
  }

  function fontUrls(): string[] {
    const dir = resolve(publicDir, "fonts");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => FONT_RE.test(file))
      .sort()
      .map((file) => appUrl(`fonts/${file}`));
  }

  function sendServiceWorker(res: ServerResponse, precache: string[]) {
    const template = readFileSync(resolve(publicDir, "sw.js"), "utf8");
    res.setHeader("Content-Type", "text/javascript");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Service-Worker-Allowed", "/");
    res.end(renderServiceWorker(template, buildId, base, precache));
  }

  return {
    name: "pwa-shell",
    config() {
      return { define: { __BUILD_ID__: JSON.stringify(buildId) } };
    },
    configResolved(config) {
      base = config.base;
      publicDir = config.publicDir;
      assets = readAssetManifest();
    },
    configureServer(server) {
      const refresh = (file: string) => {
        if (file.startsWith(resolve(publicDir, "assets"))) assets = readAssetManifest();
      };
      server.watcher.on("add", refresh);
      server.watcher.on("unlink", refresh);
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0];
        if (pathname === appUrl("assets/manifest.json")) {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-cache");
          res.end(JSON.stringify(assets, null, 2));
          return;
        }
        if (pathname === appUrl("sw.js")) {
          // A dev worker precaches nothing, so it can never poison a production
          // shell cache.
          sendServiceWorker(res, []);
          return;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? "").split("?")[0] === appUrl("sw.js")) {
          // Without no-cache an update check is answered by the HTTP cache and
          // never sees a new build.
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Service-Worker-Allowed", "/");
        }
        next();
      });
    },
    generateBundle(_options, bundle) {
      // The public template must not survive as an unprocessed duplicate: drop
      // any copied copy and emit the substituted worker in its place.
      delete bundle["sw.js"];
      this.emitFile({
        type: "asset",
        fileName: "assets/manifest.json",
        source: JSON.stringify(readAssetManifest(), null, 2),
      });
      const precache = [
        base,
        ...Object.keys(bundle)
          .filter((file) => APP_ASSET_RE.test(file))
          .sort()
          .map((file) => appUrl(file)),
        ...fontUrls(),
        appUrl("wasm/kernels.wasm"),
        appUrl("manifest.webmanifest"),
        ...ICON_URLS.map((url) => appUrl(url)),
        appUrl("assets/manifest.json"),
      ];
      const template = readFileSync(resolve(publicDir, "sw.js"), "utf8");
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: renderServiceWorker(template, buildId, base, precache),
      });
    },
  };
}

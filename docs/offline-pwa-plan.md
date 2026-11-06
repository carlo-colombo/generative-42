# Plan: offline-first, installable app

Status: proposal, not implemented. Measurements taken from the current tree.

## 1. Scope

The app must install as a PWA and work with no network **without the built-in
image set being available offline**. Everything the renderer itself needs is
small; images are treated as network resources that get cached when actually
used, and user uploads (already local, in IndexedDB) are the first-class
offline source.

In scope:

- Installable on Android/Chrome, desktop Chrome/Edge, iOS Safari (Add to Home
  Screen).
- Offline: app shell, fonts, `kernels.wasm`, the image list, uploads, render,
  and PNG export.
- Built-in images: cached on demand as they are used, never bulk-precached.
- Updates: a new build installs and asks before taking over; the previous
  build is kept until the new one has rendered successfully.

Out of scope (explicitly dropped from the earlier proposal): a versioned image
"payload", packs, sha256 staging caches, payload export/import bundles, and
IndexedDB payload pointer flips. None of that is needed once images are not a
shipping requirement.

## 2. What ships

| Piece | Size | Offline requirement |
| --- | --- | --- |
| `index.html` + `/app/index-*.js` + `.css` | ~140 KB | must |
| `public/wasm/kernels.wasm` | 755 KB | must |
| `public/fonts/*` (6 ttf) | 1.1 MB | must |
| icons | small | must |
| `assets/manifest.json` | tiny | must (else the dropdown is empty) |
| `public/assets/*` (24 images) | 126.7 MB | **no** — runtime cache, on demand |
| user uploads | IndexedDB | already local |

Total mandatory precache: **~2 MB**. That is a normal, reliable install.

## 3. What "offline" means after this change

| Thing | Offline behavior |
| --- | --- |
| Cold navigation / deep link with `?seed=`/`?layers=` | Served from the shell cache. All state is already in the URL + `localStorage`, so the same generation renders. |
| WASM + fonts | Always cached with the shell; no network path exists. |
| Image dropdown | Populated from the cached `manifest.json` (plus uploads). |
| Selected built-in image | Renders if it was loaded once while online; otherwise no image. |
| Uploaded image | Works — decoded locally, stored in IndexedDB, never needed the network. |
| Generate / export PNG | Works — pure canvas (`downloadImage`). |
| Export/import presets | Works — `localStorage` + JSON files. |
| "New image from the network" | Only available online; not required. |

## 4. Cache model

Two caches, both written by the service worker:

- `shell-<buildId>` — `/`, `/app/*` (hashed, immutable), icons, fonts,
  `/wasm/kernels.wasm`, `manifest.json`. Precached at install from a list
  generated into `sw.js` at build time.
- `images` — one runtime cache for `/assets/*`. Cache-first, filled on demand
  when the app successfully loads an image. Bounded by explicit size policy
  (§7).

One previous shell cache (`shell-previous`) is kept for rollback (§6).

| Request | Strategy |
| --- | --- |
| `navigate` | `shell-<buildId>` `index.html`, cache-first; network only to look for a new shell |
| `/app/*`, icons, `/fonts/*`, `/wasm/kernels.wasm` | cache-first, immutable |
| `/assets/manifest.json` | cache-first, revalidated in the background when online |
| `/assets/*` images | `images` cache first; on miss → network, then store (skip if over the size budget) |
| `/sw.js`, `*.webmanifest` | network, `no-store` for `sw.js` |
| anything else | pass through |

Notes:

- `sw.js` must be served from the origin root with `Cache-Control: no-cache`
  (`Service-Worker-Allowed: /` if it ever moves), otherwise update checks are
  satisfied by the HTTP cache and never see a new build.
- Revalidation of `manifest.json` uses `no-store` + a conditional request and
  updates the shell cache entry; images that disappeared from the manifest are
  left in the `images` cache but hidden by the dropdown.
- No `skipWaiting` on install; see §6.
- Registration is skipped outside `import.meta.env.PROD` unless `?sw=1`, and
  `generate/headless.ts` must open with `?sw=0`: `pnpm generate` runs through
  `vite preview`, so a fresh Puppeteer profile would otherwise install a
  service worker mid-capture.

## 5. Offline image behavior and UX

Two things have to be true for the "no images offline" case to feel
intentional rather than broken:

1. **The app never looks empty.** `src/app.tsx` today replaces a missing
   built-in image with the first one in the manifest, and `src/stage.ts`
   reports `image-failed`. Offline with an uncached image and no uploads, the
   stage currently shows "IMAGE FAILED". Change it to a dedicated state:
   "NO IMAGE OFFLINE — upload an image or reconnect", with the upload button
   visible. The app must remain fully interactive without a rendered stage.
2. **Countdown before losing the network.** When the selected built-in image
   is not in the `images` cache and the browser is online, warm it in the
   background as soon as the generation changes (it is about to be needed
   anyway), so the common case — "I used this image, then opened the laptop on
   a plane" — just works. Same for the image referenced by the last stored
   generation at startup.

Mark built-in images in the dropdown: cached (no badge), not cached but online
(a subtle "cloud" hint), not cached and offline (disabled with a tooltip).
Uploads are always marked local. There is no starter-image preset: a first run
that is offline has no image until the user uploads one, and that is the
expected, documented behavior. The empty state above is the whole design for
that case.

## 6. Shell updates

- A new build's `sw.js` precaches `shell-<newBuildId>` and then waits.
- The page shows "New version available — Reload". On accept:
  `postMessage({type:'skipWaiting'})` → `controllerchange` → reload.
- The old shell cache is renamed `shell-previous` and deleted only after the
  new page reports that the stage reached `rendered` (a `postMessage` from
  `main.tsx`). A build that fails to boot can therefore be rolled back by
  keeping the old cache and offering "Go back to the previous version", which
  is a pointer flip in the SW plus a reload — no download.
- If the new build never reports ready, the UI after the reload offers rollback
  instead of a dead page.
- `clients.claim()` only after the user accepts, so the first visit is served
  by the network and `pnpm dev` is never shadowed by a stale page.

## 7. Storage

- `navigator.storage.persist()` on first successful install (and before the
  first upload write). Uploads are the app's real local data: `MAX_UPLOAD_DIMENSION`
  is 4096 and `MAX_UPLOADS` is 24, so the upload store alone can exceed a
  couple hundred MB. Without a persist grant a browser eviction would delete
  user work, which is worse than losing a cache.
- **The image cache budget is not a fixed 40 MB.** The whole built-in set is
  126.7 MB, which fits comfortably in the storage every browser gives an
  origin (Chrome/Edge: ~60% of total disk; Safari: ~1 GB per origin; both far
  above this). A 40 MB cap would evict images the user demonstrably uses, so
  use a quota-derived budget instead:

  `budget = min(512 MB, 50% of quota - upload bytes - 20 MB slack)`

  In practice the cap is therefore ~127 MB (“everything”), and it only bites
  on a device that is nearly full. The cap exists to protect uploads and the
  rest of the origin, not to limit the app.
- Eviction inside that budget is LRU by last use, tracked explicitly in
  `IndexedDB` `gen42-pwa.images` (`path`, `bytes`, `lastUsed`, `sha` from the
  HTTP `ETag`). The page evicts, not the SW, so LRU order is meaningful.
- Because the budget covers the full set, the menu also offers an explicit
  **"Make all images available offline"** action: it reads sizes from
  `manifest.json`, shows the true total (today 126.7 MB), and downloads with
  progress into the `images` cache. This is the only bulk download in the
  app, it is always user-initiated, and it replaces the old pack concept.
- `storage.estimate()` (usage + quota) is shown in the right panel next to the
  image-cache size, so a user can see what "all images" would cost before
  starting.
- "Clear offline images" and "Clear offline data" actions, with the current
  uploads count shown before any destructive action.
- Before caching an image on demand, skip silently (and keep the "cloud"
  badge) if it would exceed the budget above.

## 8. Installability and metadata

- `public/manifest.webmanifest`: `name`, `short_name`, `display: standalone`,
  `start_url: "/"`, `scope: "/"`, `background_color`, `theme_color`,
  `icons` 192/512 + one `maskable`. A rendered seed PNG is a fitting icon.
- `index.html`: `<link rel="manifest">`, `theme-color`,
  `apple-mobile-web-app-*`, `apple-touch-icon`, `mobile-web-app-capable`.
- HTTPS (or localhost) with the service worker at the origin root.
- iOS: no `beforeinstallprompt`; install is manual via Share → Add to Home
  Screen. Installed apps get their own cache container and are exempt from
  ITP's 7-day eviction — worth saying in the help popover, since it is the
  main reason to install rather than bookmark.

## 9. Prerequisite cleanup (small, still worth doing)

`vite build` currently writes `public/assets/manifest.json` back into the
source tree from `assetManifestPlugin`, and Vite emits app chunks into
`dist/assets/` next to the images. Both make the cache routing above muddy:

- `vite.config.ts`: `build.assetsDir: 'app'` → `/app/index-<hash>.js`.
- Emit `manifest.json` as a build artifact (`dist/assets/manifest.json`),
  served in dev by middleware, instead of writing into `public/`.
- Keep every payload URL as-is (`/assets/…`, `/fonts/…`, `/wasm/…`) so
  existing `?image=` links, `?layers=` generations, `localStorage.generation`
  and `generate/headless.ts` are unaffected.
- Optional: have the plugin also expose the manifest list as a virtual module
  so the image dropdown has a built-in fallback list even on a first offline
  visit.

## 10. Files

New:

- `public/sw.js` — precache list injected at build time, routing table,
  shell lifecycle (`installing`/`waiting`/`activated`/`previous`), image cache,
  `skipWaiting`/rollback/stage-ready messages.
- `public/manifest.webmanifest`, `public/icons/icon-192.png`,
  `icon-512.png`, `icon-maskable-512.png`.
- `src/pwa/register.ts` — registration, `controllerchange`, waiting-worker
  plumbing, dev and `?sw=0` bypass.
- `src/pwa/update-state.ts` — signals: `updateStatus` (`idle | checking |
  installing | ready | error`), `waitingBuildId`, `canRollback`, storage
  usage, `imageCache` stats.
- `src/pwa/image-cache.ts` — warm on demand, LRU bookkeeping,
  quota-derived budget, bulk "all images" download, cached/online/offline
  state per built-in image.
- `src/components/UpdatePanel.tsx` — "Offline" section: install hint, version,
  check button, reload prompt, rollback, image cache size + clear, storage bar.
- `vite-plugin-pwa-shell.ts` — build ID, precache list into `sw.js`,
  `manifest.json` artifact + dev middleware, `__BUILD_ID__` define.

Changed:

- `vite.config.ts` — `assetsDir: 'app'`, add the plugin, keep the manifest
  plugin but stop writing into `public/`.
- `index.html` — PWA head.
- `src/main.tsx` — register the SW after the stage reports `rendered`; send
  stage-ready; mount `UpdatePanel`.
- `src/app.tsx` — dropdown badges and disabled offline entries.
- `src/stage.ts` / `src/main.tsx` — the "no image offline" state instead of
  "IMAGE FAILED".
- `src/uploads.ts` — `persist()` before writes.
- `generate/headless.ts` — `?sw=0`.
- `AGENTS.md` — document the shell/image cache split and the `?sw=0` flag.

## 11. Milestones

**M0 — routing split, no behavior change.**
`assetsDir: 'app'`; `manifest.json` as a build artifact; no SW.
Acceptance: `pnpm build && pnpm preview` renders; `pnpm generate` writes the
same PNG; `git status` clean after a build; old `?image=`/`?layers=` URLs
unchanged.

**M1 — installable shell.**
`sw.js` + webmanifest + icons + registration; precache shell, fonts, wasm,
manifest.
Acceptance: DevTools offline + hard reload renders and loads fonts/WASM;
Lighthouse "Installable" passes; `pnpm dev` unaffected; `pnpm generate`
byte-identical for a seed.

**M2 — offline images.**
`images` runtime cache, warm-on-use, dropdown badges, "NO IMAGE OFFLINE"
state, quota-derived budget, "make all images available offline" + clear.
Acceptance: load an image online, go offline, reload → renders and exports;
an uncached built-in image offline shows the empty state and the app stays
usable; a cold offline visit with an upload renders that upload; after the
bulk action the budget holds all 126.7 MB and `estimate()` reports it.

**M3 — updates and rollback.**
Waiting-worker prompt, `shell-previous`, stage-ready confirmation, rollback,
`persist()` + storage panel.
Acceptance: deploy a new build → prompt appears, reload activates it; break
the new build on purpose → rollback restores the previous render; `estimate()`
and cache size are accurate; clearing offline images leaves uploads intact.

**M4 — polish.**
iOS install hint, offline/online indicator, retry-on-reconnect for the
selected image, `AGENTS.md` update.

## 12. Risks and open questions

- **First offline visit with nothing cached** — settled: no starter image is
  precached. A fresh install opened offline shows the §5 empty state until the
  user uploads. The empty state is therefore load-bearing, not a fallback.
- **Large built-in images**: 10 files are >5 MB and the largest is 23 MB;
  warming a 23 MB image on a metered connection is rude. Warm only the
  selected image, and only when `navigator.connection.saveData` is false. The
  explicit "make all images available offline" action is the only bulk
  download and always shows the 126.7 MB total first.
- **iOS eviction** — installed PWAs can still be evicted under pressure;
  `persist()` helps, not guarantees. Uploads are the real loss, so the upload
  store should get an export path (zip of blobs) in M4.
- **Hosting headers** — `sw.js` needs `no-cache`; some CDNs rewrite headers
  and would break update checks. Verify against the real target before M1.
- **Dev ergonomics** — the SW must never run in `pnpm dev` by default, or HMR
  chases stale chunks. The `?sw=1` escape hatch exists for testing.

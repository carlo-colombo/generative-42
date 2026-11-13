# AGENTS.md

Guidance for AI agents working in this repository.

## Overview

Generative art tool built with TypeScript, Canvas 2D, and WebAssembly. Given an
image, a stack of
layers, and some text, it renders a single static canvas per `seed`. Each stack
row is either an effect layer (a shape plus any effect from the registry) or a
text layer. A browser UI edits the stack; a headless Puppeteer script renders
seeds to PNG for offline use.

## Commands

- `pnpm dev` — rebuild the WASM kernels, then start Vite
- `pnpm build` — rebuild WASM, typecheck (`tsc`), then build (`vite build`)
- `pnpm preview` — serve the built `dist/`
- `pnpm generate --image=<path>` — headless render seed 1 to `output/gen-1.png`
- `pnpm generate:all --image=<path>` — headless render seeds 1–10
- `pnpm build:wasm` — compile the Zig kernels with Zig 0.17.x
- `pnpm test:wasm` — rebuild and test WASM kernels, including pixel sort, detail noise, and Voronoi
- `VITE_BASE=/generative-42/ pnpm build` — build for a subdirectory deployment
- Typecheck only: `pnpm exec tsc --noEmit`

After TypeScript changes, run `pnpm exec tsc --noEmit` (or `pnpm build`). After Zig changes, run `pnpm build:wasm` and `pnpm test:wasm`.

The app adds `?sw=1` to force the service worker on (its only use is testing it
under `pnpm dev`/`preview`) and `?sw=0` to skip registering one; without the flag
registration runs only in a production build. `?sw=0` does not uninstall or
disable an installed worker: that worker still serves navigations, `/app/*`,
fonts, WASM, and icons from its cached shell, so the flag is not an escape hatch
on a device that already has the app. `pnpm generate` opens `?sw=0` and uses a
fresh Puppeteer profile, so no worker exists to intercept the capture.

## Architecture

- `src/paths.ts` — the deployment base. `BASE` is `import.meta.env.BASE_URL`
  (from `vite.config.ts` `base`, set by `VITE_BASE`), `appUrl` prefixes a
  logical app path, `logicalPath` strips the base from a URL pathname. Deployed
  paths (`/wasm/kernels.wasm`, `/assets/manifest.json`, `/app/*`, `/sw.js`) go
  through it; generation values (image references, font paths) stay logical
  root-relative, so a URL made under one base still renders under another.
- `src/main.tsx` — entry point. Reads the generation (URL params, localStorage,
  or `DEFAULT_GENERATION`), mounts the Canvas 2D renderer into the center
  `.stage`, and renders the left and right panels. A `ResizeObserver` sizes the stage to the available
  space while preserving the canvas aspect ratio. One debounced preview pipeline
  calls the composition renderer; the render signature is
  `JSON.stringify(generation)`, so every layer field participates. It takes a
  pending `?share=` request before reading the generation (see `## Sharing`),
  registers the service worker at startup, posts `stage-ready` after the first
  successful render of the load, and reloads once on `online` when the stage is
  stuck at `image-offline`/`image-failed`.
- `src/app.tsx` — `LeftPanel` (image and crop) and `RightPanel` (the layer list,
  the add-layer controls, the selected layer inspector, the layer presets, the
  mask preview toggle, and the Offline panel), plus the image manifest fetch.
  The manifest fallback only replaces a missing `/assets/...` image, so an
  `upload:` reference is left alone.
- `src/uploads.ts` — client-side image uploads. Files are decoded locally (never
  sent anywhere), downscaled to at most 4096 px on the long side, and stored in
  IndexedDB (`generative42`: `uploads` metadata + `upload-files` blobs). The
  generation stores `upload:<id>` instead of a path; `imageSource` resolves that
  to an object URL for the stage and the crop preview, and `uploads` is the
  signals list (`UploadedImage` with a thumbnail data URL) that `SourceControls`
  renders. Renaming an upload rewrites only its metadata record (trimmed, one
  line, 80 chars), so the stored blob is untouched. Deleting an upload revokes
  its object URL and drops both records.
  `MAX_UPLOADS` caps the store at 24; the UI reports quota/read failures.
  `addUploads` loads the store first when it has not been read yet, so an import
  that runs before the panel mounts still counts against the cap.
- `src/share.ts` — Android sharing. `takeShareRequest` consumes the `share` URL
  param before the generation is read, `importShare` turns the files parked by
  the worker into uploads, and `shareNotice` feeds the Image section. See
  `## Sharing`.
- `src/generation-state.ts` — Preact signals model (`committed` / `draft`), the
  `layers` serialization, layer sanitization, and legacy-URL/localStorage
  migration. `applyGeneration` navigates to a new URL, so the stage bootstraps
  from scratch. `MAX_LAYERS` (20) caps the stack.
- `src/components/*.tsx` — panel controls (`SourceControls`, `CropControls`,
  `LayerList`, `LayerControls`, `Presets`, `Actions`, `ToolButtons`,
  `ControlField`, `Segmented`, `HelpPopover`). `SourceControls` holds the source
  dropdown (built-in assets plus uploads) and the uploaded-image thumbnail grid
  with upload/select/rename/remove; rename edits the name inline in the tile.
- `src/style.css` — three-column layout: left controls, centered stage, right
  layer controls; stacks vertically below 940px.
- `src/types.ts` — the `Layer` union (`EffectLayer | TextLayer`), `EffectId`,
  `EffectParams`/`DEFAULT_EFFECT_PARAMS`, `DEFAULT_GENERATION`, `LAYER_COLORS`,
  and `FULL_CANVAS_SHAPE`. Adding a new generation option means updating
  `Generation`, `DEFAULT_GENERATION`, the URL param read/write in
  `generation-state.ts`, and the UI controls.
- `src/effects.ts` — effect registry keyed by `EffectId`:
  `{ label, defaults, controls, render }`. Controls are range/select/toggle
  descriptors over `EffectParams`, and `LayerControls` renders them
  automatically. Effects: `pixel-sort`, `galaxy`, `voronoi`, `sections`,
  `detail-noise`, `curtain-grid`, `grey-squares`, `rect`, `circles`, `lines`,
  `vertical-lines`, `horizontal-lines`. `normalizeEffectId` aliases the legacy
  `color-sorting` and `pixel-sort-areas` ids to `pixel-sort`. `params.amount` is
  the share of each run a pixel-sort layer sorts (control, shown as 100 when a
  migrated layer still carries null); only pixel-sort reads it, and switching a
  layer's effect resets it to that effect's defaults. `params.voronoiPoints` is
  the target site count for `voronoi`, the only effect that reads it.
  The seven sampled drawing effects batch their source quadrilaterals through
  WASM; Canvas 2D rasterizes the generated shapes. `sections` uses the WASM
  pixel-filter kernel. `curtain-grid` is fully fused in WASM: it averages the
  source into the configured grid, paints the curtains, and applies inverse,
  posterize, or grayscale without a second canvas buffer or a second filter
  pass.
- `src/compose.ts` — the composition engine. Starts from the cropped source RGBA
  and walks visible layers bottom-to-top, rendering each into one clear
  Canvas 2D `Surface` scratch (pixel density 1, draw state reset), then
  compositing it with normal alpha over the accumulated result through the
  chunked WASM compositor. Effect `render` receives `{ ctx, source, mask, seed,
  random, params, edge, generation, wasm }`, where `source` is an `ImageData`
  view of the composite below (so effects chain). Caches masks and per-layer
  buffers; cache keys chain the config of every layer below, so a top-layer edit
  does not re-render lower
  effects. Masks and buffers are cleared on crop, canvas-size, or seed change.
- `wasm/src/sort_kernel.zig` — runtime pixel sort: bucketed luminance runs,
  mask-segmented runs, ragged block offsets, spans, legacy amount, and contained
  blocks. `src/sort.ts` remains only as a reference used by `wasm/test-sort.ts`.
- `wasm/src/voronoi_sites.zig` and `wasm/src/kernels.zig` — deterministic
  Bridson Poisson-disc sites and Voronoi cell pixel averaging run in WASM;
  `wasm/test-voronoi.ts` checks site spacing, determinism, and cell colors.
- `wasm/src/detail_kernel.zig` — rolling-window local luminance deviation and
  seeded noise for `detail-noise`; scratch memory is proportional to the rolling
  window plus one `f32` detail map, not full-frame summed-area tables.
- `wasm/src/mask_kernel.zig` — rect/ellipse distance masks and path scanline fill;
  path distance work is restricted to the feather/jitter band. `src/masks.ts`
  constructs pixel-space rings with `shapePolygon` and calls this kernel for both
  composition and the stage mask preview.
- `wasm/src/kernels.zig` — also contains batched quad sampling, filters, fused
  curtain-grid rendering, and chunked RGBA compositing. `public/wasm/kernels.wasm`
  is required before the stage renders; there is no TypeScript fallback if it
  fails. Add `?wasmProfile=1` to record named User Timing entries around kernels.
- `src/areas.ts` — shape math and the seeded PRNG: `hashString`, `mulberry32`,
  and `shapePolygon`. `shapePolygon` returns the pixel-space mask ring the editor
  draws; pixel mask generation is handled by WASM.
- `src/text.ts` — Canvas 2D text rasterization (opaque; the engine applies layer
  opacity) and the exported `drawSeedLabel` for the `seed=` overlay.
- `src/editor-state.ts` — editor signals (`selectedLayerId`, `tool`,
  `maskPreview`, `showMasks`, `canvasSize`, `newEffect`) and the unified layer
  CRUD helpers (`createEffectLayer`, `createTextLayer`, add/update/remove/
  duplicate/move), plus the shape clamp/translate/copy helpers. `newEffect` is
  the effect a newly drawn shape creates.
- `src/presets.ts` — named layer-stack presets (`{ id, name, createdAt,
  updatedAt, layers }`) persisted in `localStorage` under `layer-presets`. The
  store is a signals list (`presets`) with save (same name replaces), duplicate,
  rename, delete, JSON export/import, and `layersForPreset`, which clones a
  preset's layers with fresh ids for the current stack. Layers are sanitized
  with `sanitizeLayers` on read, so a hand-edited or foreign file cannot inject
  a bad layer. Presets carry no seed, image, or crop, so a stack loads onto any
  image; `MAX_LAYERS` trims the load.
- `src/components/Presets.tsx` — the right-panel preset section: name + save,
  load mode (`Add` appends on top of the stack, `Replace` swaps the whole
  stack), the preset rows (load, duplicate, inline rename, delete), and
  export/import of `layer-presets.json`, which holds
  `{ kind, version, exportedAt, presets: [{ name, layers }] }`. Import also
  accepts a bare preset list, a bare layer array, or a whole generation, and
  renames name clashes instead of overwriting.
- `src/components/StageEditor.tsx` — canvas overlay above the rendered stage.
  Only effect layers are outlined and editable; it owns the drawing tools and canvas
  gestures, plus the outlines on/off toggle pinned to the top-right corner of the
  stage (so it stays reachable while the panels scroll). Shapes are stored
  normalised 0..1 against the cropped canvas. Sort chevrons appear only on
  `pixel-sort` layers, and the mask preview covers effect layers only.
- `src/components/LayerList.tsx` — the unified stack list (UI top = topmost
  layer): type chip, name, visibility, solo, duplicate, delete, up/down, and
  drag-and-drop reorder. `LayerControls.tsx` dispatches on layer kind; the effect
  inspector includes the effect dropdown (resetting params to that effect's
  defaults while keeping shape/edge/opacity), generated effect controls, edge
  mode/feather/jitter, opacity, colour, and label.
- `src/stage.ts` — asynchronously loads the source image, fonts, and WASM,
  crops the image, pads it with the frame, creates the base canvas at the framed
  pixel size, and hands the render function to `main.tsx`. Reports `no-image` when the generation has
  no source image, `image-offline` when a built-in image that is not in the
  `images` cache fails to load (the browser keeps `navigator.onLine` true for a
  stopped server, so the cache decides), and `image-failed` otherwise — an
  upload or a corrupt cached image. Sets
  `canvas.base-layer.dataset.composed`
  to the rendered seed for headless capture. The `seed=` label stays on a
  separate overlay canvas that is never exported. `downloadImage` in
  `src/surface.ts` exports the base composition (text included).
- `src/frame.ts` — framing runs before composition and never crops or rescales
  the image. `frameLayout(width, height, generation)` returns the padded canvas
  (`null` when `frameOn` is off): the smallest `frameRatioW:frameRatioH` box
  around the image, grown by `frameGrowth` percent, long side capped at 8192 px,
  with the image centred at its native size at `x`/`y`;
  `frameSurfaceIncrease` is the display-only percent. `applyFrame` fills the box
  with `frameColor` (falling back to `#ffffff`) and draws the source over it,
  returning the same surface when framing is off. The compositor's source — the
  mask, the shapes, the text, every effect sample — is therefore the framed
  canvas. `src/components/FrameControls.tsx` is the left-panel Frame section
  (enable, colour, custom ratio, growth, resulting size).
- `src/color.ts` — scales source `ImageData` and batches quadrilateral color
  samples through WASM.
- `src/surface.ts` — Canvas 2D `Surface` creation, resize/reset, pixel access,
  image loading/cropping, and PNG download helpers.
- `src/random.ts` — the `Random` interface and `createRandom(seed)`, used by
  every randomized effect for deterministic output across runs.
- `src/fonts.ts` — `FONTS` list (`label` + `path`), `DEFAULT_FONT`, and the
  `FontFace` loader. Font files live in `public/fonts/`; every `FONTS` entry
  must exist there, because the stage loads them during bootstrap.
- `generate/headless.ts` — Puppeteer script. Builds, starts `pnpm preview` on
  port 4173, opens the app with `?seed=N&sw=0`, waits for the composition-ready
  flag, captures `canvas.base-layer`, and writes `output/gen-N.png`.
- `vite-plugin-pwa-shell.ts` — stamps one build id per config load, exposes it
  as `__BUILD_ID__`, substitutes it plus the precache list into `public/sw.js`
  as a build artifact, and emits `dist/assets/manifest.json`. In dev it serves
  both from middleware (an empty precache, so a dev worker can never poison a
  production shell cache).
- `public/sw.js` — the shell worker: precache, routing, the share target POST,
  and the update / rollback lifecycle described under `## Offline and updates`.
- `src/pwa/register.ts` — registration, waiting-worker detection,
  `acceptUpdate`, `rollbackToPrevious`, `checkForUpdates`, and `notifyStageReady`.
- `src/pwa/update-state.ts` — the PWA signals (`updateStatus`, `waitingBuildId`,
  `canRollback`, `serviceWorkerState`, `stageRendered`, `online`,
  `installPrompt`, `storageEstimate`, `imageCacheStats`) and `buildId`.
- `src/pwa/image-cache.ts` — the `images` runtime cache, warm on demand, LRU
  bookkeeping, the quota-derived image budget, the bulk download, and the
  cached/online/offline state of each built-in image. It also owns the
  `gen42-pwa` IndexedDB (stores `images` and `meta`).
- `src/components/UpdatePanel.tsx` — the right-panel Offline section: build and
  connection state, update check/prompt/rollback, install hint, storage bars,
  image cache size, bulk download, and the two clear actions.
- `public/manifest.webmanifest`, `public/icons/*` — installability metadata; the
  webmanifest is precached, the icons are too. It also declares the
  `share_target` (`./share-target`, POST multipart, images only).

## Layers

`Generation.layers` is stored bottom-to-top; the right panel shows it
top-to-bottom. The cropped, framed source image is the implicit background, so
an empty stack renders the source and nothing else.

`Layer = EffectLayer | TextLayer`, and both carry `id`, `label`, `visible`, and
`opacity`.

- `EffectLayer` adds `color` (the editor outline and chip tint, not part of the
  render), `shape` (`rect`, `ellipse`, or `path`, normalised 0..1), `edge`
  (`feather`, `jitter`, `mode`), `effect`, and `params`. The effect paints inside
  the shape mask. A full-canvas effect is a rect layer covering 0..1; there is
  no global draw selector.
- `TextLayer` adds `text`, `align`, `vAlign`, `x`, `y`, `size`, and `font`. Text
  layers are full-canvas positioned, are not stage-editable, and have no shape
  mask in this pass. Text is rasterized into a transparent scratch, composited
  in stack order with its opacity, and baked into exports.

Each visible layer renders over the composite below it, so galaxy -> pixel-sort
chains sample the galaxy output. Only normal alpha compositing is used; there
are no blend modes. `soloLayerId` narrows the render to one layer.

Per-layer RNG seed is `seed ^ hashString(layer.id)`, so a layer's own
randomness stays stable when layers are reordered. Reordering still changes the
composite because each effect samples the layers below it. The generic
compositor applies edge coverage once:
`blend` alpha = `bufferAlpha * maskWeight * opacity`, `ragged` alpha =
`bufferAlpha * (maskWeight > 0 ? 1 : 0) * opacity`. Feather is a ramp inward from
the whole shape border and therefore a blend-only control; jitter displaces each
pixel-sort run's sorted block and is a ragged-only control. With
`containedBlocks` off the block keeps the run's length and slides along the whole
line, so pixels it leaves uncovered inside the run stay unsorted; with it on the
block is shorter than the run and stays inside it, so raggedness comes only from
the mask edge noise and the per-line block length. A single unrotated
rect covering the whole canvas at feather 0 and jitter 0 skips the mask
entirely.

Ellipse rings use `clamp(ceil(perimeter / 2), 96, 512)` segments. An open path
closes along the canvas border between its first and last crossing; when the
stroke crosses the border more than twice the ring closes over the widest
crossing pair and still walks the excursion vertices, so those interiors keep
their even-odd parity. `AreaShape` `path.tension` is reserved and unused.

## Serialization and migration

Presets are the one browser-local store that is not part of the generation:
`localStorage.layer-presets` holds `{ version, presets }`. Nothing in the URL
or the rendered output depends on it. Uploaded images are the other
browser-local store, kept in IndexedDB and referenced as `image=upload:<id>`; a
URL with an upload reference only renders in the browser that made the upload.
(`sessionStorage.upload-errors` carries upload notices across the reload that
selecting a new image triggers.)

`layers` is one URL param: base64url-encoded, quantized JSON. Past 6000
characters the URL stores `layers=<id>` instead and the payload goes to
`localStorage` under `layers:<id>`, so such a URL resolves only in the browser
that created it. A failed `localStorage` write falls back to the inline param.
`frameOn`, `frameRatioW`, `frameRatioH`, `frameGrowth`, and `frameColor` are
scalar params too. `frameColor` falls back to `#ffffff` when it is not
`#rrggbb`, and stored state clamps the ratio to 1–50 and the growth to 0–300,
so a hand-edited URL or localStorage entry cannot ask for an insane canvas.
`soloLayerId` is a separate scalar param. `applyGeneration` also writes the full
generation to `localStorage.generation` and deletes the legacy keys (`draw`,
`texts`, `areas`, `areasMode`, `soloAreaId`, the per-layer text params, and the
old effect globals).

When a URL or stored generation has no `layers`, it is migrated:

- `draw=pixel-sort-areas`: one pixel-sort layer per legacy area, in area order,
  with that area's shape, edge, direction, reverse, and randomness; no global
  effect layer. Areas are budgeted against the text layers so the `MAX_LAYERS`
  cap never truncates the texts. `soloAreaId` becomes `soloLayerId` when it maps
  to one of them.
- `draw=color-sorting`: one full-canvas pixel-sort layer carrying the legacy
  `colorSortAmount` as `amount` and `colorSortDirection`; reverse off and
  randomness 0.
- Any other draw: one full-canvas effect layer from `draw` plus the legacy
  effect fields (`grayLevels`, `section*`, `detailNoiseMode`, and any
  `colorSortAmount`), with the legacy text layers above it.
- Legacy texts come from the `texts` param (inline or `texts:<id>` storage),
  then the pre-change per-layer params (`text`, `textSize`, `text2`, ...), then
  the two default text layers.

Per-layer seeds mean migrated renders need not be pixel-identical to the old
ones. The legacy `amount` behavior (each run sorted by a deterministic share with
the old per-line wobble) is the same code a live layer runs whenever `amount` is
set; a migrated layer keeps its `amount`, and a layer created after the change
defaults to 100. Switching a layer's effect resets `amount` to that effect's
defaults, which is null for every effect but pixel-sort.

## Conventions

- TypeScript, single quotes, no semicolon-statement comments; keep code
  uncommented unless asked.
- UI is Preact + `@preact/signals`; controls read `model.draft.value` so edits
  preview live, and `model.applyGeneration()` commits them via a reload.
- The canvas is sized exactly to the cropped source image; do not assume a fixed
  canvas size.
- Generation is deterministic across runs given the seed, using one seeded
  `mulberry32` PRNG per effect layer. The Canvas 2D implementation is not
  pixel-compatible with the former p5 renderer.
- User-visible text is uppercased (see the text field handler and `drawText`).
- Non-scaling overlays must scale with the image. Baseline convention: text
  sized relative to `min(width, height) / 926`, the mantova.jpg short side.
- Images and fonts are served from `public/` and must be added to the asset
  directory to appear in the Image dropdown (`dist/assets/manifest.json` lists
  them; dev serves the same list from middleware). Only fonts are tracked;
  images are build/deploy or upload content.
- A generation can have `image: ''`, meaning no source. The stage then reports
  `no-image` and the UI shows the upload affordance instead of a canvas.

## Assets

- `public/assets/` — not tracked beyond `.gitkeep`. The repository ships no
  source images: they come from user uploads or from a deployment that drops
  files into the directory.
- `dist/assets/manifest.json` — JSON array of image filenames shown in the Image
  dropdown. A build artifact, generated from `public/assets` on every build and
  served from middleware in dev; nothing writes it back into `public/`.
- `public/fonts/*.ttf` — licensed fonts (see `public/fonts/OFL.txt`), tracked.
- A deployment-provided image keeps working through `?image=` and old URLs; a
  missing one reports `image-offline` (offline) or `image-failed` rather than
  being silently swapped.

## Offline and updates

Two caches, both written by the worker, plus two browser-local stores:

- `shell-<buildId>` — the app itself: `/`, the hashed `/app/*` chunks, icons,
  fonts, `/wasm/kernels.wasm`, `manifest.webmanifest`, and
  `/assets/manifest.json`. ~2 MB, precached on install. `vite-plugin-pwa-shell`
  injects the build id (`__BUILD_ID__`, also read by the page) and the precache
  list into `sw.js`; nothing precached is fetched lazily.
- `shell-previous` — the shell of the build being replaced, renamed there on
  activation and deleted once the new build reports `stage-ready`.
- `images` — one runtime cache for `/assets/*`. Cache-first, filled on demand;
  the page (not the worker) evicts, so LRU order means something. `gen42-pwa`
  IndexedDB stores `images` records (`path`, `bytes`, `lastUsed`, `sha`) and the
  shell pointers in `meta`. Budget is `min(512 MB, 50% of quota - upload bytes -
  20 MB slack)`, so it holds the whole built-in set unless the device is nearly
  full. `navigator.storage.persist()` is requested on first install and before
  the first upload write; uploads (IndexedDB) are the real local data.

Routing: navigations, `/app/*`, fonts, wasm, and icons resolve against the
selected shell cache (see below), `/assets/*` against `images`, `/sw.js` and
`*.webmanifest` go to the network with `no-store`/`no-cache`, everything else
passes through. `dist/assets/manifest.json` is cache-first with a background
`no-store` revalidation.

Update lifecycle: a new build precaches its own shell and waits — no
`skipWaiting` on install and no `clients.claim()`, so the first visit stays
network-served and `pnpm dev` is never shadowed. The page detects the waiting
worker at startup and on `updatefound`/`installed` (`updateStatus`:
`idle | checking | installing | ready | error`), reads its build id over a
`MessageChannel` `get-state`, and offers "New version available — Reload".
Accepting posts `skipWaiting` to the waiting worker; the activation renames the
outgoing shell to `shell-previous`, records `activeBuild`, and claims clients,
and the page reloads on `controllerchange` (idempotent: one flag, one reload).

Rollback: `meta` holds four pointers — `activeBuild` (what the worker
activated), `selectedBuild` (what navigations and `/app/*` resolve against;
rollback is a flip of this pointer plus a reload), `previousBuild`, and
`lastReadyBuild`. A page whose stage never renders posts no `stage-ready`, so
the active build has no `lastReadyBuild`. The Offline panel only then offers
"Go back to the previous version", and only after a terminal stage status
(`image-failed`/`wasm-failed`) or 15 s without a render — a healthy build can
spend longer than that decoding a 23 MB image, fonts, and WASM, and an offer
during that window would strand the user on the old build. `previousBuild`
always names the build actually stored in `shell-previous`, including after a
rollback that is followed by an update. The rollback message flips
`selectedBuild` to the previous build and acknowledges over a `MessageChannel`
before the page reloads, so the reload is served by `shell-previous` and its
hashed `/app/*` chunks resolve there even if `dist/app` changed underneath.
`stage-ready` from the active build deletes `shell-previous`; one from the
rolled-back build does not.

Hosting: `/sw.js` must be served with `Cache-Control: no-cache` (and
`Service-Worker-Allowed: /` if it ever moves off the root), otherwise an update
check is answered by the HTTP cache, no new build is ever found, and the
rollback safety net never gets a chance to run. `vite-plugin-pwa-shell` sets
both headers for dev and preview; a real deployment (especially behind a CDN)
must do the same.

## Sharing

Android's share sheet is the only ingest path outside the Image panel, and it is
image-only: sharing a link or a block of text lands on the app with a notice in
the Image section instead of doing something. iOS has no share target, so
nothing here is written for it.

The manifest declares `share_target` (`action: ./share-target`, `method: POST`,
`enctype: multipart/form-data`, one `files` entry with `image/*`), which
resolves against the manifest URL and therefore lands under the deployment base
without templating. Chrome only offers the app once it is installed and its
worker is active; both are required for the POST to be intercepted at all.

The worker handles the POST before its GET-only routing. Every `File` in the
form (whatever the field name) is written to the `shares` cache under
`<base>share/<id>` with its MIME type (sniffed from the extension when Android
sends none), its percent-encoded name in `x-shared-name`, and a timestamp in
`x-shared-at`. The worker then answers with a `303` to a GET that carries
`?share=<ids>` (comma-separated), or `?share=none` when the share held no file.

That redirect reuses the URL of the open window (`clients.matchAll`, focused
first) when there is one, so the generation being edited — seed, crop, the
whole layer stack — survives the share and only `image` changes. When the app
is launched cold from the home screen, the target is the bare base and the
stored generation is what survives.

`src/share.ts` runs before `getGeneration()`: it removes `share` from the URL
with `replaceState`, so the rest of the URL still describes the generation the
app had open, reads the cached files, deletes those cache entries, stores the
files as uploads (all of them, up to `MAX_UPLOADS`), and commits the first one
as the source with `applyGeneration` — the same reload the upload button uses.
A share therefore works offline end to end: the POST is answered by the worker,
the shell comes from its cache, and the file never leaves the device.
Unconsumed shares are pruned after 24 h, on activation and on the next share.

Testing: `pnpm preview` (a dev worker with `?sw=1` works too) — the share
endpoint only exists while a worker controls the page, and `?sw=0` sends the
POST to the server, which 404s. A multipart `fetch('/share-target', { method:
'POST', body: form })` from a controlled page exercises the whole path; the
redirect target is in `response.url`, then navigating to it performs the
import. On a device, install the app first, then share an image from Gallery.

## Deployment

GitHub Pages serves the app at `https://carlo-colombo.github.io/generative-42/`
from the `dist/` artifact of the last push to `main`
(`.github/workflows/deploy.yml`: install, `pnpm build`, upload, deploy with the
Pages actions). The workflow runs `actions/configure-pages`, which reports the
project base path (`/generative-42/`) and is passed as `VITE_BASE`; nothing is
committed to a `gh-pages` branch. `dist/.nojekyll` is added so Jekyll never
filters a file.

Because the site lives under a subdirectory, `base` is not `/` in production:
`src/paths.ts` and the `__BASE__` placeholder in `public/sw.js` carry the base
into registration scope, service-worker routing, the precache list, fonts,
WASM, and the image manifest. Building without `VITE_BASE` still targets the
domain root, so local `pnpm dev`, `pnpm preview`, and `pnpm generate` behave as
before.

`public/wasm/kernels.wasm` is generated and ignored by Git. The deploy workflow
installs Zig 0.17.1, rebuilds and tests the kernels before building the app;
`pnpm dev`, `pnpm build`, and `pnpm test:wasm` also rebuild them locally.
Puppeteer is installed with `PUPPETEER_SKIP_DOWNLOAD=1` because only the local
`pnpm generate` script uses it. The deployed site ships no built-in images (the
repository has none), so thumbnails come from the user's own uploads, which
stay in that browser's IndexedDB.

Testing over the network without a domain: service workers require HTTPS or
`localhost`. `pnpm preview` allows `.trycloudflare.com` hosts, so a quick tunnel
(`cloudflared tunnel --url http://localhost:4173`) gives a secure origin on any
device; add other tunnel domains with
`VITE_ALLOWED_HOSTS=host1,host2 pnpm preview` (the same list applies to
`pnpm dev`). `?sw=1` enables the worker under `pnpm dev`; `pnpm preview` serves a
production build where registration is automatic. Accessing a raw LAN IP works
for the UI but never registers a worker, because that origin is not secure.

## Workflow notes

- Unless asked otherwise, work is trunk-based with continuous deployment: commit
  and push to `main` once each feature is complete, which deploys the site
  through `.github/workflows/deploy.yml`. No feature branches, pull requests, or
  release tagging unless requested.
- `dist/` is a build output; regenerate via `pnpm build`.
- `/generate/headless.ts` captures `canvas.base-layer`, which now includes text;
  the stage overlay and the `seed=` canvas are never part of an export.

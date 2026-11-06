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

- `pnpm dev` — start Vite dev server
- `pnpm build` — typecheck (`tsc`) then build (`vite build`)
- `pnpm preview` — serve the built `dist/`
- `pnpm generate` — headless render seed 1 to `output/gen-1.png`
- `pnpm generate:all` — headless render seeds 1–10
- `pnpm build:wasm` — compile the Zig kernels with Zig 0.17.x
- `pnpm test:wasm` — test WASM kernels, including pixel sort, detail noise, and Voronoi
- Typecheck only: `pnpm exec tsc --noEmit`

After TypeScript changes, run `pnpm exec tsc --noEmit` (or `pnpm build`). After Zig changes, run `pnpm build:wasm` and `pnpm test:wasm`.

## Architecture

- `src/main.tsx` — entry point. Reads the generation (URL params, localStorage,
  or `DEFAULT_GENERATION`), mounts the Canvas 2D renderer into the center
  `.stage`, and renders the left and right panels. A `ResizeObserver` sizes the stage to the available
  space while preserving the canvas aspect ratio. One debounced preview pipeline
  calls the composition renderer; the render signature is
  `JSON.stringify(generation)`, so every layer field participates.
- `src/app.tsx` — `LeftPanel` (image and crop) and `RightPanel` (the layer list,
  the add-layer controls, the selected layer inspector, the layer presets, the
  mask preview toggle), plus the image manifest fetch.
- `src/generation-state.ts` — Preact signals model (`committed` / `draft`), the
  `layers` serialization, layer sanitization, and legacy-URL/localStorage
  migration. `applyGeneration` navigates to a new URL, so the stage bootstraps
  from scratch. `MAX_LAYERS` (20) caps the stack.
- `src/components/*.tsx` — panel controls (`SourceControls`, `CropControls`,
  `LayerList`, `LayerControls`, `Presets`, `Actions`, `ToolButtons`,
  `ControlField`, `Segmented`, `HelpPopover`).
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
  gestures. Shapes are stored normalised 0..1 against the cropped canvas. Sort
  chevrons appear only on `pixel-sort` layers, and the mask preview covers
  effect layers only.
- `src/components/LayerList.tsx` — the unified stack list (UI top = topmost
  layer): type chip, name, visibility, solo, duplicate, delete, up/down, and
  drag-and-drop reorder. `LayerControls.tsx` dispatches on layer kind; the effect
  inspector includes the effect dropdown (resetting params to that effect's
  defaults while keeping shape/edge/opacity), generated effect controls, edge
  mode/feather/jitter, opacity, colour, and label.
- `src/stage.ts` — asynchronously loads the source image, fonts, and WASM,
  crops the image, creates the base canvas at the cropped pixel size, and hands
  the render function to `main.tsx`. Sets `canvas.base-layer.dataset.composed`
  to the rendered seed for headless capture. The `seed=` label stays on a
  separate overlay canvas that is never exported. `downloadImage` in
  `src/surface.ts` exports the base composition (text included).
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
  port 4173, opens the app with `?seed=N`, waits for the composition-ready flag,
  captures `canvas.base-layer`, and writes `output/gen-N.png`.

## Layers

`Generation.layers` is stored bottom-to-top; the right panel shows it
top-to-bottom. The cropped source image is the implicit background, so an empty
stack renders the source and nothing else.

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
or the rendered output depends on it.

`layers` is one URL param: base64url-encoded, quantized JSON. Past 6000
characters the URL stores `layers=<id>` instead and the payload goes to
`localStorage` under `layers:<id>`, so such a URL resolves only in the browser
that created it. A failed `localStorage` write falls back to the inline param.
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
- Images and fonts are served from `public/` and must be added to
  `public/assets/manifest.json` to appear in the Image dropdown.

## Assets

- `public/assets/*.jpg` — source images
- `public/assets/manifest.json` — JSON array of image filenames shown in the UI
- `public/fonts/*.ttf` — licensed fonts (see `public/fonts/OFL.txt`)

## Workflow notes

- Commits are explicit — only commit when asked.
- `dist/` is a build output; regenerate via `pnpm build`.
- `/generate/headless.ts` captures `canvas.base-layer`, which now includes text;
  the stage overlay and the `seed=` canvas are never part of an export.

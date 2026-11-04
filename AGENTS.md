# AGENTS.md

Guidance for AI agents working in this repository.

## Overview

Generative art tool built with p5.js and TypeScript. Given an image, a stack of
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
- Typecheck only: `pnpm exec tsc --noEmit`

After any code change, run `pnpm exec tsc --noEmit` (or `pnpm build`) to verify.

## Architecture

- `src/main.tsx` — entry point. Reads the generation (URL params, localStorage,
  or `DEFAULT_GENERATION`), mounts p5 into the center `.stage`, and renders the
  left and right panels. A `ResizeObserver` sizes the stage to the available
  space while preserving the canvas aspect ratio. One debounced preview pipeline
  calls the composition renderer; the render signature is
  `JSON.stringify(generation)`, so every layer field participates.
- `src/app.tsx` — `LeftPanel` (image and crop) and `RightPanel` (the layer list,
  the add-layer controls, the selected layer inspector, the mask preview toggle),
  plus the image manifest fetch.
- `src/generation-state.ts` — Preact signals model (`committed` / `draft`), the
  `layers` serialization, layer sanitization, and legacy-URL/localStorage
  migration. `applyGeneration` navigates to a new URL, so the sketch re-runs from
  scratch. `MAX_LAYERS` (20) caps the stack.
- `src/components/*.tsx` — panel controls (`SourceControls`, `CropControls`,
  `LayerList`, `LayerControls`, `Actions`, `ToolButtons`, `ControlField`,
  `Segmented`, `HelpPopover`).
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
  automatically. Effects: `pixel-sort`, `galaxy`, `sections`, `detail-noise`,
  `grey-squares`, `rect`, `circles`, `lines`, `vertical-lines`,
  `horizontal-lines`. `normalizeEffectId` aliases the legacy `color-sorting` and
  `pixel-sort-areas` ids to `pixel-sort`. `params.amount` is hidden from the
  controls and only pixel-sort reads it; a legacy `colorSortAmount` survives on
  any migrated layer, but switching that layer's effect resets it.
- `src/compose.ts` — the composition engine. Starts from the cropped source RGBA
  and walks visible layers bottom-to-top, rendering each into one clear
  `p5.Graphics` scratch (`pixelDensity(1)`, draw state reset), then compositing
  it with normal alpha over the accumulated result. Effect `render` receives
  `{ p, source, mask, seed, params, edge, generation }`, where `source` is a
  fresh `p5.Image` of the composite below (so effects chain). Caches masks and
  per-layer buffers; cache keys chain the config of every layer below, so a
  top-layer edit does not re-render lower effects. Masks and buffers are cleared
  on crop, canvas-size, or seed change.
- `src/sort.ts` — raw pixel sort (`sortPixels`): bucketed luminance runs,
  mask-segmented runs, ragged block offsets. It writes raw sorted pixels; the
  generic mask compositor applies feather/ragged alpha exactly once.
- `src/areas.ts` — p5-free shape math: `maskWeight` builds the 0..1 mask for a
  rect, ellipse, or path shape (feather ramp, ragged noise); also `hashString`,
  `mulberry32`, and `shapePolygon`. `maskWeight` reuses one scratch buffer, so a
  caller that keeps a mask must copy it. `shapePolygon` returns the pixel-space
  mask ring the editor draws, and the ring distance pass is skipped entirely
  when feather and jitter are both 0.
- `src/text.ts` — glyph rasterization (opaque; the engine applies layer opacity)
  and the exported `drawSeedLabel` for the `seed=` overlay.
- `src/editor-state.ts` — editor signals (`selectedLayerId`, `tool`,
  `maskPreview`, `showMasks`, `canvasSize`, `newEffect`) and the unified layer
  CRUD helpers (`createEffectLayer`, `createTextLayer`, add/update/remove/
  duplicate/move), plus the shape clamp/translate/copy helpers. `newEffect` is
  the effect a newly drawn shape creates.
- `src/components/StageEditor.tsx` — canvas overlay above the p5 stage. Only
  effect layers are outlined and editable; it owns the drawing tools and canvas
  gestures. Shapes are stored normalised 0..1 against the cropped canvas. Sort
  chevrons appear only on `pixel-sort` layers, and the mask preview covers
  effect layers only.
- `src/components/LayerList.tsx` — the unified stack list (UI top = topmost
  layer): type chip, name, visibility, solo, duplicate, delete, up/down, and
  drag-and-drop reorder. `LayerControls.tsx` dispatches on layer kind; the effect
  inspector includes the effect dropdown (resetting params to that effect's
  defaults while keeping shape/edge/opacity), generated effect controls, edge
  mode/feather/jitter, opacity, colour, and label.
- `src/sketch.ts` — the p5 sketch. Preloads every font and the source image,
  crops the image, creates the base canvas at the cropped pixel size, and hands
  the render function to `main.tsx`. One `renderComposition` call replaces the
  old draw function + separate text canvas. Sets `canvas.base-layer.dataset.composed`
  to the rendered seed for headless capture. The `seed=` label stays on a
  separate overlay canvas that is never exported. `downloadImage` exports the
  base composition (text included).
- `src/color.ts` — color helpers (e.g. `averageColorInArea`).
- `src/fonts.ts` — `FONTS` list (`label` + `path`) and `DEFAULT_FONT`. Font
  files live in `public/fonts/`; every `FONTS` entry must exist there, because
  the sketch preloads all of them.
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
pixel-sort run's sorted block and is a ragged-only control. A single unrotated
rect covering the whole canvas at feather 0 and jitter 0 skips the mask
entirely.

Ellipse rings use `clamp(ceil(perimeter / 2), 96, 512)` segments. An open path
closes along the canvas border between its first and last crossing; when the
stroke crosses the border more than twice the ring closes over the widest
crossing pair and still walks the excursion vertices, so those interiors keep
their even-odd parity. `AreaShape` `path.tension` is reserved and unused.

## Serialization and migration

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
  `colorSortAmount` as the hidden `amount` and `colorSortDirection`; reverse off
  and randomness 0.
- Any other draw: one full-canvas effect layer from `draw` plus the legacy
  effect fields (`grayLevels`, `section*`, `detailNoiseMode`, and any
  `colorSortAmount`), with the legacy text layers above it.
- Legacy texts come from the `texts` param (inline or `texts:<id>` storage),
  then the pre-change per-layer params (`text`, `textSize`, `text2`, ...), then
  the two default text layers.

Per-layer seeds mean migrated renders need not be pixel-identical to the old
ones. The legacy `amount` behavior (each run sorted by a deterministic share with
the old per-line wobble) only applies while a migrated layer still runs
`pixel-sort`; switching its effect resets `amount` to null.

## Conventions

- TypeScript, single quotes, no semicolon-statement comments; keep code
  uncommented unless asked.
- UI is Preact + `@preact/signals`; controls read `model.draft.value` so edits
  preview live, and `model.applyGeneration()` commits them via a reload.
- The canvas is sized exactly to the cropped source image; do not assume a fixed
  canvas size.
- Generation is fully deterministic given the seed (seeded randoms per layer,
  `noLoop`).
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

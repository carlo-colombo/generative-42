# AGENTS.md

Guidance for AI agents working in this repository.

## Overview

Generative art tool built with p5.js and TypeScript. Given an image, a draw
function, and some text, it renders a single static canvas per `seed`.
A browser UI tweaks generation settings; a headless Puppeteer script renders
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
  space while preserving the canvas aspect ratio.
- `src/app.tsx` — `LeftPanel` (image, effects, selection, seed/generate actions)
  and `RightPanel` (the text layer list and the selected layer's controls),
  plus the image manifest fetch.
- `src/generation-state.ts` — Preact signals model (`committed` / `draft`),
  URL and localStorage serialization. `applyGeneration` navigates to a new URL,
  so the sketch re-runs from scratch.
- `src/components/*.tsx` — panel controls (`SourceControls`, `CropControls`,
  `TextLayerList`, `TextLayerActions`, `TextControls`, `Actions`,
  `ControlField`).
- `src/style.css` — three-column layout: left controls, centered stage, right
  text controls; stacks vertically below 940px.
- `src/types.ts` — `Generation` interface and `DEFAULT_GENERATION`. Adding a
  new generation option means updating `Generation`, `DEFAULT_GENERATION`,
  the URL param read/write in `generation-state.ts`, and the UI controls.
- `src/sketch.ts` — the p5 sketch. `createSketch(gen)` preloads every font and
  the image, creates a canvas at the image's pixel size, seeds `randomSeed`/
  `noiseSeed` with `gen.seed`, runs the draw function, then draws the text
  overlay and the `seed=` label. `extractImage`/`downloadImage` export the
  canvas.
- `src/draws.ts` — registry of draw functions (`DRAWS`). Each takes a
  `DrawContext` (`p`, `img`, `seed`, `generation`). Add new draw styles here
  and they appear in the UI dropdown automatically.
- `src/sort.ts` — pixel-sorting core. `sortPixels` sorts one masked pass
  (bucketed luminance runs, weight blending, ragged offsets) and `sortAreas`
  composites the `generation.areas` layers or their union; `generation.soloAreaId`
  narrows the render to a single area. `color-sorting` runs one implicit
  full-canvas area through the same path.
- `src/areas.ts` — p5-free area math: `areaWeight` builds the 0..1 mask for a
  rect, ellipse, or path area (feather ramp, ragged noise), plus `hashString`
  and `mulberry32`. `shapePolygon` returns the pixel-space mask ring the editor
  draws, and the ring distance pass is skipped entirely when feather and jitter
  are both 0.
- `src/editor-state.ts` — area editor signals (selection, active tool, mask
  preview, right-panel tab, canvas size) plus the area CRUD helpers.
- `src/components/StageEditor.tsx` — canvas overlay above the p5 stage. Draws
  the draft areas (outline, upstream feather band, chevrons, label), the mask
  preview, and the shape handles; owns the drawing tools and the canvas
  gestures. Shapes are stored normalised 0..1 against the cropped canvas.
- `src/components/AreaControls.tsx`, `AreaList.tsx`, and `ToolButtons.tsx` —
  area inspector, ordered area list, and the shape-tool buttons shared by the
  stage toolbar and the Areas tab.
- `src/main.tsx` — mounts the stage column (toolbar above the stage), the
  editor overlay, and the three Preact roots.
- `src/color.ts` — color helpers (e.g. `averageColorInArea`).
- `src/fonts.ts` — `FONTS` list (`label` + `path`) and `DEFAULT_FONT`. Font
  files live in `public/fonts/`; every `FONTS` entry must exist there, because
  the sketch preloads all of them.
- `generate/headless.ts` — Puppeteer script. Builds, starts `pnpm preview`
  on port 4173, opens the app with `?seed=N`, captures the canvas, and writes
  PNGs to `output/`.

## Text layers

`Generation.texts` holds the text layers (`TextLayer` in `src/types.ts`),
capped at `MAX_TEXT_LAYERS` (8) in `generation-state.ts`. A URL carries them in
a single `texts` param: base64url-encoded JSON. When that payload exceeds 1500
characters the URL stores `texts=<id>` instead and the layers go to
`localStorage` under `texts:<id>`, so such a URL only resolves in the browser
that created it. Pre-change per-layer params (`text`, `textSize`, `text2`, ...)
and `localStorage.generation` blobs are still migrated through the same legacy
key map.

## Sort areas

`Generation.areas` is an ordered list of `SortArea` shapes (rect, ellipse, or
path, including concave rings and open curves with a `side`). Each area carries
its own direction, reverse, feather, ragged edge, and opacity; coordinates are
normalised 0..1 against the cropped canvas, so changing the crop re-anchors an
area to the new frame rather than to image content. Feather and jitter are
relative to `min(width, height)`.

Ellipse rings use `clamp(ceil(perimeter / 2), 96, 512)` segments. An open path
closes along the canvas border between its first and last crossing; when the
stroke crosses the border more than twice the ring closes over the widest
crossing pair and still walks the excursion vertices, so those interiors keep
their even-odd parity. `AreaShape` `path.tension` is reserved and unused.

`areas` is serialized exactly like `texts`: base64url JSON in one param, with
`areas=<id>` and an `localStorage` entry past 6000 characters, so such a URL
resolves only in the browser that created it. The stored copy is the same
quantized JSON that produced the encoding, and a failed `localStorage` write
falls back to the inline param. `areasMode` is `layers` (each area sorts and
composites in list order, with alpha = feather weight * opacity) or `union` (one
pass using the topmost area's sort options); `soloAreaId` narrows the render to a
single area and `MAX_AREAS` (12) caps the list. A single unrotated rect area
that covers the whole canvas at feather 0, jitter 0, opacity 100 and blend mode
skips the mask entirely, which is the path `color-sorting` takes. Rendering only
follows areas
for the `pixel-sort-areas` draw; `/generate/headless.ts` captures
`canvas.base-layer`, so the stage overlay canvas is never part of an export.

## Conventions

- TypeScript, single quotes, no semicolon-statement comments; keep code
  uncommented unless asked.
- UI is Preact + `@preact/signals`; controls read `model.draft.value` so edits
  preview live, and `model.applyGeneration()` commits them via a reload.
- The canvas is sized exactly to the source image (`createCanvas(img.width,
  img.height)`); do not assume a fixed canvas size.
- Generation is fully deterministic given the seed (seeded randoms, `noLoop`).
- User-visible text is uppercased (see the textarea `input` handler).
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

# AGENTS.md

Guidance for AI agents working in this repository.

## Overview

Generative art tool built with p5.js and TypeScript. Given an image, a draw
function, and some text, it renders a single static canvas per `seed`.
A browser UI tweaks generation settings; a headless Puppeteer script renders
seeds to PNG for offline use.

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — typecheck (`tsc`) then build (`vite build`)
- `npm run preview` — serve the built `dist/`
- `npm run generate` — headless render seed 1 to `output/gen-1.png`
- `npm run generate:all` — headless render seeds 1–10
- Typecheck only: `npx tsc --noEmit`

After any code change, run `npx tsc --noEmit` (or `npm run build`) to verify.

## Architecture

- `src/main.ts` — entry point. Reads generation from URL params (or
  localStorage, or `DEFAULT_GENERATION`), builds the control panel DOM, and
  instantiates p5.
- `src/types.ts` — `Generation` interface and `DEFAULT_GENERATION`. Adding a
  new generation option means updating `Generation`, `DEFAULT_GENERATION`,
  the URL param read/write in `main.ts`, and the UI controls.
- `src/sketch.ts` — the p5 sketch. `createSketch(gen)` preloads the font and
  image, creates a canvas at the image's pixel size, seeds `randomSeed`/
  `noiseSeed` with `gen.seed`, runs the draw function, then draws the text
  overlay and the `seed=` label. `extractImage`/`downloadImage` export the
  canvas.
- `src/draws.ts` — registry of draw functions (`DRAWS`). Each takes a
  `DrawContext` (`p`, `img`, `text`, `seed`). Add new draw styles here and
  they appear in the UI dropdown automatically.
- `src/color.ts` — color helpers (e.g. `averageColorInArea`).
- `src/fonts.ts` — `FONTS` list (`label` + `path`) and `DEFAULT_FONT`. Font
  files live in `public/fonts/`.
- `generate/headless.ts` — Puppeteer script. Builds, starts `npm run preview`
  on port 4173, opens the app with `?seed=N`, captures the canvas, and writes
  PNGs to `output/`.

## Conventions

- TypeScript, single quotes, no semicolon-statement comments; keep code
  uncommented unless asked.
- UI controls are created imperatively with `document.createElement` in
  `main.ts` — no template/framework.
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
- `dist/` is a build output; regenerate via `npm run build`.

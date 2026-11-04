import p5 from "p5";
import type { Generation } from "./types";
import { cropImage } from './crop';
import { DEFAULT_FONT, FONTS } from './fonts';
import { createCompositionEngine, type CompositionEngine } from './compose';
import { drawSeedLabel } from './text';

type RenderResult = { imageChanged: boolean; resized: boolean }
export type SketchStatus = 'rendered' | 'image-changed' | 'image-failed'
type SketchReady = (
  baseCanvas: HTMLCanvasElement,
  seedCanvas: HTMLCanvasElement,
  render: (generation: Generation) => RenderResult,
) => void
type SketchStatusListener = (status: SketchStatus) => void

export function createSketch(initial: Generation, onReady?: SketchReady, onStatus?: SketchStatusListener) {
  const fonts: Record<string, p5.Font> = {};
  let renderer: p5;
  let sourceImage: p5.Image;
  let img: p5.Image;
  let seedLayer: p5.Graphics;
  let engine: CompositionEngine;
  let current = initial;
  let cropKey = cropSignature(initial);
  let imageFailed = false;

  function cropSignature(gen: Generation) {
    return `${gen.cropFormat}:${gen.cropX}:${gen.cropY}:${gen.cropSize}`;
  }

  function fontFor(path: string): p5.Font | undefined {
    return fonts[path] ?? fonts[DEFAULT_FONT] ?? Object.values(fonts)[0];
  }

  function render(next: Generation): RenderResult {
    if (next.image !== current.image) {
      onStatus?.('image-changed');
      return { imageChanged: true, resized: false };
    }
    const nextCrop = cropSignature(next);
    let resized = false;
    if (nextCrop !== cropKey) {
      img = cropImage(sourceImage, next);
      cropKey = nextCrop;
      renderer.resizeCanvas(img.width, img.height);
      renderer.pixelDensity(1);
      seedLayer.resizeCanvas(img.width, img.height);
      seedLayer.pixelDensity(1);
      engine.reset();
      resized = true;
    }
    if (next.seed !== current.seed) engine.reset();
    current = next;
    engine.render(next, img, fontFor);
    drawSeedLayer(next);
    renderer.noLoop();
    const baseCanvas = (renderer as unknown as { canvas: HTMLCanvasElement }).canvas;
    baseCanvas.dataset.composed = String(next.seed);
    onStatus?.('rendered');
    return { imageChanged: false, resized };
  }

  function drawSeedLayer(generation: Generation) {
    seedLayer.clear();
    const textLayer = generation.layers.find((layer) => layer.kind === 'text');
    const font = fontFor(textLayer?.font ?? DEFAULT_FONT);
    if (font) drawSeedLabel(seedLayer, font, generation.seed);
  }

  const sketch = (p: p5) => {
    p.preload = () => {
      const fontPaths = new Set([
        ...FONTS.map((font) => font.path),
        ...initial.layers.filter((layer) => layer.kind === 'text').map((layer) => layer.font),
      ]);
      for (const path of fontPaths) {
        fonts[path] = p.loadFont(path, undefined, () => {
          delete fonts[path];
          (p as unknown as { _decrementPreload: () => void })._decrementPreload();
        });
      }
      sourceImage = p.loadImage(initial.image, undefined, () => {
        imageFailed = true;
        onStatus?.('image-failed');
      });
    };

    p.setup = () => {
      if (imageFailed) {
        p.noLoop();
        return;
      }
      renderer = p;
      p.pixelDensity(1);
      p.imageMode(p.CORNER);
      img = cropImage(sourceImage, current);
      p.createCanvas(img.width, img.height);
      const baseCanvas = (p as unknown as { canvas: HTMLCanvasElement }).canvas;
      baseCanvas.classList.add('base-layer');
      seedLayer = p.createGraphics(img.width, img.height);
      seedLayer.pixelDensity(1);
      const seedCanvas = (seedLayer as unknown as { canvas: HTMLCanvasElement }).canvas;
      seedCanvas.classList.add('seed-layer');
      seedCanvas.style.display = 'block';
      engine = createCompositionEngine(p);
      onReady?.(baseCanvas, seedCanvas, render);
      p.noLoop();
      render(current);
    };

    p.draw = () => {
      p.noLoop();
    };
  };

  return sketch;
}

export function extractImage(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

export function downloadImage(canvas: HTMLCanvasElement, filename: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png", 1.0);
  link.click();
}

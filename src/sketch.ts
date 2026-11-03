import p5 from "p5";
import type { Generation, TextAlign, TextVAlign } from "./types";
import { DRAWS } from "./draws";
import { cropImage } from './crop';
import { DEFAULT_FONT, FONTS } from './fonts';

type TextCanvas = p5 | p5.Graphics
type SketchReady = (baseCanvas: HTMLCanvasElement, textCanvas: HTMLCanvasElement, renderText: (generation: Generation) => void) => void

export function createSketch(gen: Generation, onReady?: SketchReady) {
  const fonts: Record<string, p5.Font> = {};
  let img: p5.Image;
  let textLayer: p5.Graphics;

  const drawDefinition = DRAWS[gen.draw] ?? DRAWS["rect"];
  const drawFn = drawDefinition.draw;

  function fontFor(path: string) {
    return fonts[path] ?? fonts[DEFAULT_FONT] ?? Object.values(fonts)[0];
  }

  const sketch = (p: p5) => {
    p.preload = () => {
      const fontPaths = new Set([...FONTS.map((font) => font.path), ...gen.texts.map((layer) => layer.font)]);
      for (const path of fontPaths) {
        fonts[path] = p.loadFont(path, undefined, () => {
          delete fonts[path];
          (p as unknown as { _decrementPreload: () => void })._decrementPreload();
        });
      }
      img = p.loadImage(gen.image);
    };

    p.setup = () => {
      p.pixelDensity(1);
      img = cropImage(img, gen);
      p.createCanvas(img.width, img.height);
      const baseCanvas = (p as unknown as { canvas: HTMLCanvasElement }).canvas;
      baseCanvas.classList.add('base-layer');
      textLayer = p.createGraphics(img.width, img.height);
      textLayer.pixelDensity(1);
      const textCanvas = (textLayer as unknown as { canvas: HTMLCanvasElement }).canvas;
      textCanvas.classList.add('text-layer');
      textCanvas.style.display = 'block';
      onReady?.(baseCanvas, textCanvas, (generation) => drawTextLayer(textLayer, generation));
      p.rectMode(p.CENTER);
      p.noLoop();
      p.randomSeed(gen.seed);
      p.noiseSeed(gen.seed);
      p.draw();
    };

    p.draw = () => {
      drawFn({ p, img, seed: gen.seed, generation: gen });
      p.noLoop();
    };
  };

  function drawTextLayer(target: p5.Graphics, generation: Generation) {
    target.clear();
    const labelFont = fontFor(generation.texts[0]?.font ?? DEFAULT_FONT);
    if (!labelFont) return;
    for (const layer of generation.texts) {
      if (!layer.text) continue;
      drawText(target, layer.text, layer.size, layer.opacity, layer.x, layer.y, layer.align, layer.vAlign, fontFor(layer.font) ?? labelFont);
    }

    target.textAlign(target.LEFT);
    target.fill(255);
    target.noStroke();
    target.textFont(labelFont);
    const unit = Math.min(target.width, target.height) / 926;
    target.textSize(24 * unit);
    target.text(`seed=${generation.seed}`, 20 * unit, 40 * unit);
  }

  function drawText(
    p: TextCanvas,
    value: string,
    size: number,
    opacity: number,
    x: number,
    y: number,
    align: TextAlign,
    vAlign: TextVAlign,
    loadedFont: p5.Font
  ) {
    const alpha = Math.round((opacity / 100) * 255);
    p.noStroke();
    p.textFont(loadedFont);
    p.textSize(size);
    p.textAlign(align);
    p.fill(255, alpha);
    const text = value
      .toUpperCase()
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
    const lines = text.split("\n").length;
    const context = (p as unknown as { drawingContext: CanvasRenderingContext2D }).drawingContext;
    const metrics = text.split("\n").map((line) => context.measureText(line));
    const measuredAscent = Math.max(...metrics.map((line) => line.actualBoundingBoxAscent || 0));
    const measuredDescent = Math.max(...metrics.map((line) => line.actualBoundingBoxDescent || 0));
    const ascent = measuredAscent || p.textAscent();
    const descent = measuredDescent || p.textDescent();
    const leading = p.textLeading();
    const blockHeight = ascent + descent + (lines - 1) * leading;
    const lineX = (p.width * x) / 100;
    const positionY = (p.height * y) / 100;
    const baseline = vAlign === "top"
      ? positionY + ascent
      : vAlign === "bottom"
        ? positionY - descent - (lines - 1) * leading
        : positionY - blockHeight / 2 + ascent;
    p.text(text, lineX, baseline);
  }

  return sketch;
}

export function extractImage(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

export function downloadImage(baseCanvas: HTMLCanvasElement, textCanvas: HTMLCanvasElement, filename: string) {
  const canvas = document.createElement('canvas');
  canvas.width = baseCanvas.width;
  canvas.height = baseCanvas.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.drawImage(baseCanvas, 0, 0);
  context.drawImage(textCanvas, 0, 0);
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png", 1.0);
  link.click();
}

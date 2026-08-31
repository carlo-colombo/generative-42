import p5 from "p5";
import type { Generation } from "./types";
import { DRAWS } from "./draws";
import { cropImage } from './crop';

type TextCanvas = p5 | p5.Graphics
type SketchReady = (baseCanvas: HTMLCanvasElement, textCanvas: HTMLCanvasElement, renderText: (generation: Generation) => void) => void

export function createSketch(gen: Generation, onReady?: SketchReady) {
  let font: p5.Font;
  let font2: p5.Font;
  let img: p5.Image;
  let textLayer: p5.Graphics;

  const drawDefinition = DRAWS[gen.draw] ?? DRAWS["rect"];
  const drawFn = drawDefinition.draw;

  const sketch = (p: p5) => {
    p.preload = () => {
      font = p.loadFont(gen.font);
      font2 = p.loadFont(gen.text2Font);
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
      drawFn({ p, img, text: gen.text, seed: gen.seed, generation: gen });
      p.noLoop();
    };
  };

  function drawTextLayer(layer: p5.Graphics, generation: Generation) {
    layer.clear();
    drawText(layer, generation.text, generation.textSize, generation.textOpacity, generation.textX, generation.textY, generation.textAlign, generation.textVAlign, font);
    if (generation.text2) {
      drawText(layer, generation.text2, generation.text2Size, generation.text2Opacity, generation.text2X, generation.text2Y, generation.text2Align, generation.text2VAlign, font2);
    }

    layer.textAlign(layer.LEFT);
    layer.fill(255);
    layer.noStroke();
    layer.textFont(font);
    const unit = Math.min(layer.width, layer.height) / 926;
    layer.textSize(24 * unit);
    layer.text(`seed=${generation.seed}`, 20 * unit, 40 * unit);
  }

  function drawText(
    p: TextCanvas,
    value: string,
    size: number,
    opacity: number,
    x: number,
    y: number,
    align: Generation["textAlign"],
    vAlign: Generation["textVAlign"],
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

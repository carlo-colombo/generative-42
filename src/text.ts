import type p5 from 'p5'
import type { TextAlign, TextLayer, TextVAlign } from './types'

type TextCanvas = p5 | p5.Graphics

// Glyphs are rasterized opaque; the composition engine applies the layer opacity.
export function drawTextLayer(target: p5.Graphics, layer: TextLayer, font: p5.Font) {
  if (!layer.text) return
  drawText(target, layer.text, layer.size, layer.x, layer.y, layer.align, layer.vAlign, font)
}

export function drawText(
  p: TextCanvas,
  value: string,
  size: number,
  x: number,
  y: number,
  align: TextAlign,
  vAlign: TextVAlign,
  loadedFont: p5.Font,
) {
  p.push()
  p.noStroke()
  p.textFont(loadedFont)
  p.textSize(size)
  p.textAlign(align)
  p.fill(255)
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
  p.pop()
}

// The seed label lives on a separate, non-exported canvas above the composition.
export function drawSeedLabel(target: p5.Graphics, font: p5.Font, seed: number) {
  target.push()
  target.textAlign(target.LEFT);
  target.fill(255);
  target.noStroke();
  target.textFont(font);
  const unit = Math.min(target.width, target.height) / 926;
  target.textSize(24 * unit);
  target.text(`seed=${seed}`, 20 * unit, 40 * unit);
  target.pop()
}

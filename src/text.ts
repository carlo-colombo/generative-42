import { fontCss } from './fonts'
import type { LoadedFont } from './fonts'
import type { TextAlign, TextLayer, TextVAlign } from './types'

// Glyphs are rasterized opaque; the composition engine applies the layer opacity.
export function drawTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer, font: LoadedFont): void {
  if (!layer.text) return
  drawText(ctx, layer.text, layer.size, layer.x, layer.y, layer.align, layer.vAlign, font)
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  value: string,
  size: number,
  x: number,
  y: number,
  align: TextAlign,
  vAlign: TextVAlign,
  font: LoadedFont,
): void {
  ctx.save()
  ctx.font = fontCss(font, size)
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#fff'
  const text = value
    .toUpperCase()
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
  const lines = text.split('\n')
  const metrics = lines.map((line) => ctx.measureText(line))
  const measuredAscent = Math.max(...metrics.map((line) => line.actualBoundingBoxAscent || 0))
  const measuredDescent = Math.max(...metrics.map((line) => line.actualBoundingBoxDescent || 0))
  const ascent = measuredAscent || Math.max(...metrics.map((line) => line.fontBoundingBoxAscent || 0))
  const descent = measuredDescent || Math.max(...metrics.map((line) => line.fontBoundingBoxDescent || 0))
  const leading = size * 1.25
  const blockHeight = ascent + descent + (lines.length - 1) * leading
  const lineX = (ctx.canvas.width * x) / 100
  const positionY = (ctx.canvas.height * y) / 100
  const baseline = vAlign === 'top'
    ? positionY + ascent
    : vAlign === 'bottom'
      ? positionY - descent - (lines.length - 1) * leading
      : positionY - blockHeight / 2 + ascent
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], lineX, baseline + i * leading)
  ctx.restore()
}

// The seed label lives on a separate, non-exported canvas above the composition.
export function drawSeedLabel(ctx: CanvasRenderingContext2D, font: LoadedFont, seed: number): void {
  ctx.save()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const unit = Math.min(ctx.canvas.width, ctx.canvas.height) / 926
  ctx.font = fontCss(font, 24 * unit)
  ctx.fillText(`seed=${seed}`, 20 * unit, 40 * unit)
  ctx.restore()
}

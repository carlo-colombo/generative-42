import { createSurface, type Surface } from './surface'
import type { Generation } from './types'

export type FrameLayout = { width: number; height: number; x: number; y: number }

export type FrameConfig = Pick<Generation, 'frameOn' | 'frameRatioW' | 'frameRatioH' | 'frameGrowth' | 'frameColor'>

export const MAX_FRAME_RATIO = 50
export const MAX_FRAME_GROWTH = 300
const MAX_FRAME_SIDE = 8192
const FALLBACK_COLOR = '#ffffff'
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i

function ratioSide(value: number, fallback: number): number {
  const parsed = Number.isFinite(value) ? Math.round(value) : fallback
  return Math.max(1, Math.min(MAX_FRAME_RATIO, parsed))
}

function growthPercent(value: number): number {
  const parsed = Number.isFinite(value) ? value : 0
  return Math.max(0, Math.min(MAX_FRAME_GROWTH, parsed))
}

export function frameFillColor(value: string): string {
  return COLOR_PATTERN.test(value) ? value : FALLBACK_COLOR
}

// The smallest box of the chosen ratio that contains the image, grown by the
// requested share and capped so a frame stays inside canvas limits. The image is
// placed centered inside it, so every side is padding: nothing is ever cropped.
export function frameLayout(width: number, height: number, generation: FrameConfig): FrameLayout | null {
  if (!generation.frameOn) return null
  const imageWidth = Math.max(1, Math.round(width))
  const imageHeight = Math.max(1, Math.round(height))
  const rw = ratioSide(generation.frameRatioW, 4)
  const rh = ratioSide(generation.frameRatioH, 3)
  const scale = 1 + growthPercent(generation.frameGrowth) / 100
  const boxed = imageWidth * rh > imageHeight * rw
    ? { width: imageWidth, height: (imageWidth * rh) / rw }
    : { width: (imageHeight * rw) / rh, height: imageHeight }
  const rawWidth = boxed.width * scale
  const rawHeight = boxed.height * scale
  const cap = Math.min(1, MAX_FRAME_SIDE / Math.max(rawWidth, rawHeight))
  const frameWidth = Math.max(imageWidth, Math.round(rawWidth * cap))
  const frameHeight = Math.max(imageHeight, Math.round(rawHeight * cap))
  return {
    width: frameWidth,
    height: frameHeight,
    x: Math.floor((frameWidth - imageWidth) / 2),
    y: Math.floor((frameHeight - imageHeight) / 2),
  }
}

export function frameSurfaceIncrease(width: number, height: number, layout: { width: number; height: number }): number {
  const source = Math.max(1, Math.round(width)) * Math.max(1, Math.round(height))
  return Math.round((layout.width * layout.height / source - 1) * 100)
}

// Returns the source itself when framing is off; otherwise a new surface the
// caller owns.
export function applyFrame(source: Surface, generation: Generation): Surface {
  const layout = frameLayout(source.width, source.height, generation)
  if (!layout) return source
  const framed = createSurface(layout.width, layout.height)
  framed.ctx.fillStyle = frameFillColor(generation.frameColor)
  framed.ctx.fillRect(0, 0, framed.width, framed.height)
  framed.ctx.drawImage(source.canvas, layout.x, layout.y, source.width, source.height)
  return framed
}

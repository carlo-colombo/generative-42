import type { Generation } from './types'

export type FrameLayout = { width: number; height: number; x: number; y: number }

// The area the composition owns: the cropped image inside the frame. Effects,
// shapes, and text are normalised against it, so the frame stays a margin.
export type ContentRect = { x: number; y: number; width: number; height: number }

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

export function frameCanvasSize(width: number, height: number, generation: FrameConfig): { width: number; height: number } {
  const layout = frameLayout(width, height, generation)
  return layout ? { width: layout.width, height: layout.height } : { width, height }
}

export function contentRect(width: number, height: number, generation: FrameConfig): ContentRect {
  const layout = frameLayout(width, height, generation)
  if (!layout) return { x: 0, y: 0, width, height }
  return { x: layout.x, y: layout.y, width, height }
}

function gcd(a: number, b: number): number {
  let x = a
  let y = b
  while (y !== 0) {
    const rest = x % y
    x = y
    y = rest
  }
  return x
}

// The image's own aspect ratio as the smallest whole numbers the ratio controls
// can hold, e.g. 600x800 becomes 3:4.
export function reducedRatio(width: number, height: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const divisor = gcd(w, h)
  let ratioW = w / divisor
  let ratioH = h / divisor
  const longest = Math.max(ratioW, ratioH)
  if (longest > MAX_FRAME_RATIO) {
    const scale = MAX_FRAME_RATIO / longest
    ratioW = Math.max(1, Math.round(ratioW * scale))
    ratioH = Math.max(1, Math.round(ratioH * scale))
  }
  return { width: ratioW, height: ratioH }
}

export type Surface = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  width: number
  height: number
}

export function createSurface(
  width: number,
  height: number,
  options?: { readFrequently?: boolean; alpha?: boolean },
): Surface {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', {
    willReadFrequently: options?.readFrequently,
    alpha: options?.alpha,
  })
  if (!ctx) throw new Error(`Missing 2D context for a ${w}x${h} surface`)
  return { canvas, ctx, width: w, height: h }
}

export function surfaceFromCanvas(canvas: HTMLCanvasElement): Surface {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(`Missing 2D context for a ${canvas.width}x${canvas.height} canvas`)
  return { canvas, ctx, width: canvas.width, height: canvas.height }
}

export function resizeSurface(surface: Surface, width: number, height: number): Surface {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  if (surface.canvas.width !== w) surface.canvas.width = w
  if (surface.canvas.height !== h) surface.canvas.height = h
  surface.width = w
  surface.height = h
  return surface
}

export function clearSurface(surface: Surface): void {
  surface.ctx.clearRect(0, 0, surface.width, surface.height)
}

export function releaseSurface(surface: Surface): void {
  surface.canvas.width = 0
  surface.canvas.height = 0
  surface.width = 0
  surface.height = 0
}

export function surfacePixels(surface: Surface): ImageData {
  return surface.ctx.getImageData(0, 0, surface.canvas.width, surface.canvas.height)
}

export function resetContext(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'low'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'miter'
  ctx.lineWidth = 1
  ctx.miterLimit = 10
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
  ctx.strokeStyle = '#000'
  ctx.fillStyle = '#fff'
  ctx.filter = 'none'
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.font = 'normal 12px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.clearRect(0, 0, width, height)
}

export function resetSurface(surface: Surface): void {
  resetContext(surface.ctx, surface.canvas.width, surface.canvas.height)
}

export async function loadImageSurface(url: string): Promise<Surface> {
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch (error) {
    throw new Error(`Failed to load image surface: ${url}`, { cause: error })
  }
  const surface = createSurface(image.naturalWidth, image.naturalHeight)
  surface.ctx.drawImage(image, 0, 0)
  return surface
}

export function cropSurface(source: Surface, rect: { x: number; y: number; width: number; height: number }): Surface {
  const width = Math.min(source.width, Math.max(1, Math.round(rect.width)))
  const height = Math.min(source.height, Math.max(1, Math.round(rect.height)))
  const x = Math.max(0, Math.min(source.width - width, Math.round(rect.x)))
  const y = Math.max(0, Math.min(source.height - height, Math.round(rect.y)))
  const surface = createSurface(width, height)
  surface.ctx.drawImage(source.canvas, x, y, width, height, 0, 0, width, height)
  return surface
}

export function downloadImage(canvas: HTMLCanvasElement, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png', 1.0)
  link.click()
}

import { createCompositionEngine, type CompositionEngine } from './compose'
import { cropImage } from './crop'
import { DEFAULT_FONT, FONTS, loadFonts, type LoadedFont } from './fonts'
import { contentRect, frameCanvasSize, frameFillColor, type ContentRect } from './frame'
import { isImageCached } from './pwa/image-cache'
import { clearSurface, createSurface, loadImageSurface, releaseSurface, resizeSurface, type Surface } from './surface'
import { drawSeedLabel } from './text'
import type { Generation } from './types'
import { imageSource, isUploadRef } from './uploads'
import { loadWasmKernels, type WasmKernels } from './wasm'

export type RenderResult = { imageChanged: boolean; resized: boolean; content: ContentRect }
export type StageStatus = 'rendered' | 'image-changed' | 'image-failed' | 'image-offline' | 'wasm-failed' | 'no-image'
export type StageReady = (
  baseCanvas: HTMLCanvasElement,
  seedCanvas: HTMLCanvasElement,
  render: (generation: Generation) => RenderResult,
  wasm: WasmKernels,
  content: ContentRect,
) => void

export type Stage = { remove(): void; setImage(ref: string): Promise<boolean> }

function cropSignature(generation: Generation): string {
  return `${generation.cropFormat}:${generation.cropX}:${generation.cropY}:${generation.cropSize}`
}

function frameSignature(generation: Generation): string {
  return `${generation.frameOn}:${generation.frameRatioW}:${generation.frameRatioH}:${generation.frameGrowth}:${generation.frameColor}`
}

function isFramed(content: ContentRect, width: number, height: number): boolean {
  return content.x !== 0 || content.y !== 0 || content.width !== width || content.height !== height
}

export function createStage(
  container: HTMLElement,
  initial: Generation,
  onReady?: StageReady,
  onStatus?: (status: StageStatus) => void,
): Stage {
  const fonts = new Map<string, LoadedFont>()
  let current = initial
  let cropKey = cropSignature(initial)
  let frameKey = frameSignature(initial)
  let sourceImage: Surface | null = null
  // The cropped source image: the whole composition reads from it.
  let cropped: Surface | null = null
  // The padded area the composition owns inside the base canvas.
  let content: ContentRect = { x: 0, y: 0, width: 0, height: 0 }
  let base: Surface | null = null
  let seed: Surface | null = null
  let engine: CompositionEngine | null = null
  let removed = false
  let imageSeq = 0

  function fontFor(path: string): LoadedFont | undefined {
    return fonts.get(path) ?? fonts.get(DEFAULT_FONT) ?? fonts.values().next().value
  }

  function seedLabel(generation: Generation) {
    const target = seed
    if (!target) return
    clearSurface(target)
    if (!generation.showSeed) return
    const textLayer = generation.layers.find((layer) => layer.kind === 'text')
    const font = fontFor(textLayer?.font ?? DEFAULT_FONT)
    if (font) drawSeedLabel(target.ctx, font, generation.seed)
  }

  // The frame only pads the output: the composition keeps the cropped size and
  // is written at `content` inside it, so effects never paint over the margin.
  function updateContentRect(generation: Generation): boolean {
    const source = cropped
    const baseSurface = base
    const seedSurface = seed
    if (!source || !baseSurface || !seedSurface) return false
    const previous = content
    const next = contentRect(source.width, source.height, generation)
    content = next
    const size = frameCanvasSize(source.width, source.height, generation)
    const resized = baseSurface.width !== size.width || baseSurface.height !== size.height
    if (resized) {
      resizeSurface(baseSurface, size.width, size.height)
      resizeSurface(seedSurface, size.width, size.height)
    }
    // The padded box can keep its size while the image area inside it moves
    // (a smaller crop in the same frame), so report any content change too.
    return resized
      || next.x !== previous.x
      || next.y !== previous.y
      || next.width !== previous.width
      || next.height !== previous.height
  }

  function paintFrame(generation: Generation) {
    const baseSurface = base
    if (!baseSurface) return
    if (!isFramed(content, baseSurface.width, baseSurface.height)) return
    const context = baseSurface.ctx
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
    context.fillStyle = frameFillColor(generation.frameColor)
    context.fillRect(0, 0, baseSurface.width, baseSurface.height)
  }

  function render(next: Generation): RenderResult {
    if (next.image !== current.image) {
      onStatus?.('image-changed')
      return { imageChanged: true, resized: false, content }
    }
    const image = sourceImage
    const baseSurface = base
    const seedSurface = seed
    const composition = engine
    if (!image || !baseSurface || !seedSurface || !composition) return { imageChanged: false, resized: false, content }
    let resized = false
    const nextCrop = cropSignature(next)
    const nextFrame = frameSignature(next)
    if (nextCrop !== cropKey) {
      const replaced = cropped
      cropped = cropImage(image, next)
      cropKey = nextCrop
      composition.reset()
      // The padded size follows the crop size, so the frame has to be laid out again.
      frameKey = ''
      if (replaced) releaseSurface(replaced)
    }
    if (nextFrame !== frameKey) {
      frameKey = nextFrame
      resized = updateContentRect(next)
    }
    if (next.seed !== current.seed) composition.reset()
    current = next
    const source = cropped
    if (source) {
      paintFrame(next)
      composition.render(next, source, fontFor, content)
    }
    seedLabel(next)
    onStatus?.('rendered')
    return { imageChanged: false, resized, content }
  }

  async function setImage(ref: string): Promise<boolean> {
    const seq = ++imageSeq
    if (ref === current.image && sourceImage) return true
    if (!ref) {
      if (sourceImage) releaseSurface(sourceImage)
      if (cropped) releaseSurface(cropped)
      sourceImage = null
      cropped = null
      current = { ...current, image: '' }
      if (base) {
        base.canvas.dataset.hasSource = 'false'
        clearSurface(base)
      }
      if (seed) clearSurface(seed)
      if (!removed) onStatus?.('no-image')
      return true
    }
    onStatus?.('image-changed')
    let loaded: Surface | null = null
    try {
      const url = await imageSource(ref)
      if (!url) throw new Error(`No source for ${ref}`)
      loaded = await loadImageSurface(url)
    } catch (error) {
      console.error('Source image failed to load', error)
      if (removed || seq !== imageSeq) {
        if (loaded) releaseSurface(loaded)
        return false
      }
      if (sourceImage) releaseSurface(sourceImage)
      if (cropped) releaseSurface(cropped)
      sourceImage = null
      cropped = null
      current = { ...current, image: ref }
      if (base) {
        base.canvas.dataset.hasSource = 'false'
        clearSurface(base)
      }
      if (seed) clearSurface(seed)
      const offline = !isUploadRef(ref)
        && (!navigator.onLine || !(await isImageCached(ref)))
      if (seq === imageSeq && !removed) onStatus?.(offline ? 'image-offline' : 'image-failed')
      return false
    }
    if (removed || seq !== imageSeq) {
      releaseSurface(loaded)
      return false
    }
    if (sourceImage) releaseSurface(sourceImage)
    if (cropped) releaseSurface(cropped)
    sourceImage = loaded
    cropped = cropImage(loaded, current)
    cropKey = cropSignature(current)
    frameKey = ''
    engine?.reset()
    current = { ...current, image: ref }
    if (base) base.canvas.dataset.hasSource = 'true'
    return true
  }

  async function bootstrap() {
    const fontPaths = [
      ...FONTS.map((font) => font.path),
      ...initial.layers.filter((layer) => layer.kind === 'text').map((layer) => layer.font),
    ]
    const [loadedFonts, wasm] = await Promise.all([
      loadFonts(fontPaths),
      loadWasmKernels().catch((error) => {
        console.error('WASM kernels failed to load', error)
        onStatus?.('wasm-failed')
        return null
      }),
    ])
    if (!wasm) return
    for (const [path, font] of loadedFonts) fonts.set(path, font)
    // Start with a placeholder base even when there is no source, so the first
    // image can be swapped in without navigating. The main module drives the
    // initial load through setImage().
    base = createSurface(1, 1)
    base.canvas.classList.add('base-layer')
    base.canvas.dataset.hasSource = 'false'
    base.canvas.setAttribute('role', 'img')
    base.canvas.setAttribute('aria-label', 'Generated artwork')
    seed = createSurface(1, 1)
    seed.canvas.classList.add('seed-layer')
    seed.canvas.style.display = 'block'
    seed.canvas.setAttribute('aria-hidden', 'true')
    container.appendChild(base.canvas)
    container.appendChild(seed.canvas)
    engine = createCompositionEngine(base, wasm)
    onReady?.(base.canvas, seed.canvas, render, wasm, content)
    if (!initial.image) onStatus?.('no-image')
  }

  function remove() {
    removed = true
    for (const surface of [base, seed]) {
      if (!surface) continue
      surface.canvas.remove()
      releaseSurface(surface)
    }
    for (const surface of [cropped, sourceImage]) if (surface) releaseSurface(surface)
    base = null
    seed = null
    cropped = null
    sourceImage = null
    engine = null
  }

  void bootstrap()

  return { remove, setImage }
}

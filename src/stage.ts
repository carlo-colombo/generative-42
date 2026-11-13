import { createCompositionEngine, type CompositionEngine } from './compose'
import { cropImage } from './crop'
import { DEFAULT_FONT, FONTS, loadFonts, type LoadedFont } from './fonts'
import { applyFrame } from './frame'
import { isImageCached } from './pwa/image-cache'
import { clearSurface, createSurface, loadImageSurface, releaseSurface, resizeSurface, type Surface } from './surface'
import { drawSeedLabel } from './text'
import type { Generation } from './types'
import { imageSource, isUploadRef } from './uploads'
import { loadWasmKernels, type WasmKernels } from './wasm'

export type RenderResult = { imageChanged: boolean; resized: boolean }
export type StageStatus = 'rendered' | 'image-changed' | 'image-failed' | 'image-offline' | 'wasm-failed' | 'no-image'
export type StageReady = (
  baseCanvas: HTMLCanvasElement,
  seedCanvas: HTMLCanvasElement,
  render: (generation: Generation) => RenderResult,
  wasm: WasmKernels,
) => void

export type Stage = { remove(): void }

function cropSignature(generation: Generation): string {
  return `${generation.cropFormat}:${generation.cropX}:${generation.cropY}:${generation.cropSize}`
}

function frameSignature(generation: Generation): string {
  return `${generation.frameOn}:${generation.frameRatioW}:${generation.frameRatioH}:${generation.frameGrowth}:${generation.frameColor}`
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
  let cropped: Surface | null = null
  // The cropped source padded to the frame; equal to `cropped` when framing is off.
  let framed: Surface | null = null
  let base: Surface | null = null
  let seed: Surface | null = null
  let engine: CompositionEngine | null = null
  let removed = false

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

  function render(next: Generation): RenderResult {
    if (next.image !== current.image) {
      onStatus?.('image-changed')
      return { imageChanged: true, resized: false }
    }
    const image = sourceImage
    const baseSurface = base
    const seedSurface = seed
    const composition = engine
    if (!image || !baseSurface || !seedSurface || !composition) return { imageChanged: false, resized: false }
    let resized = false
    const nextCrop = cropSignature(next)
    const nextFrame = frameSignature(next)
    if (nextCrop !== cropKey || nextFrame !== frameKey) {
      const replaced = new Set<Surface>()
      if (cropped) replaced.add(cropped)
      if (framed) replaced.add(framed)
      cropped = cropImage(image, next)
      framed = applyFrame(cropped, next)
      cropKey = nextCrop
      frameKey = nextFrame
      for (const surface of replaced) {
        if (surface !== cropped && surface !== framed) releaseSurface(surface)
      }
      resizeSurface(baseSurface, framed.width, framed.height)
      resizeSurface(seedSurface, framed.width, framed.height)
      composition.reset()
      resized = true
    }
    if (next.seed !== current.seed) composition.reset()
    current = next
    const source = framed
    if (source) composition.render(next, source, fontFor)
    seedLabel(next)
    baseSurface.canvas.dataset.composed = String(next.seed)
    onStatus?.('rendered')
    return { imageChanged: false, resized }
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
    // No source is a normal state: the repository ships no images, so a fresh
    // install renders nothing until the user uploads one.
    if (!initial.image) {
      onStatus?.('no-image')
      return
    }
    const image = await imageSource(initial.image)
      .then((url) => loadImageSurface(url))
      .catch(async (error) => {
        console.error('Source image failed to load', error)
        // A built-in image that was never cached cannot be loaded with no
        // network, which is the expected offline case, not a broken image. The
        // browser reports navigator.onLine true for a stopped server or a dead
        // route, so the cache is the authority.
        const offline = !isUploadRef(initial.image)
          && (!navigator.onLine || !(await isImageCached(initial.image)))
        onStatus?.(offline ? 'image-offline' : 'image-failed')
        return null
      })
    if (!image) return
    if (removed) {
      releaseSurface(image)
      return
    }
    sourceImage = image
    cropped = cropImage(image, current)
    framed = applyFrame(cropped, current)
    base = createSurface(framed.width, framed.height)
    base.canvas.classList.add('base-layer')
    seed = createSurface(framed.width, framed.height)
    seed.canvas.classList.add('seed-layer')
    seed.canvas.style.display = 'block'
    container.appendChild(base.canvas)
    container.appendChild(seed.canvas)
    engine = createCompositionEngine(base, wasm)
    onReady?.(base.canvas, seed.canvas, render, wasm)
    render(current)
  }

  function remove() {
    removed = true
    for (const surface of [base, seed]) {
      if (!surface) continue
      surface.canvas.remove()
      releaseSurface(surface)
    }
    for (const surface of [cropped, framed, sourceImage]) if (surface) releaseSurface(surface)
    base = null
    seed = null
    cropped = null
    framed = null
    sourceImage = null
    engine = null
  }

  void bootstrap()

  return { remove }
}

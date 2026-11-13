import { hashString, maskKey } from './areas'
import { EFFECTS } from './effects'
import type { LoadedFont } from './fonts'
import { maskWeightWasm } from './masks'
import { createRandom } from './random'
import { createSurface, resetSurface, resizeSurface, surfacePixels, type Surface } from './surface'
import { drawTextLayer } from './text'
import type { AreaShape, EffectLayer, Generation, Layer } from './types'
import { measureWasm, type WasmKernels } from './wasm'

// Per-mask cache budget; past it the cache is dropped rather than grown.
const MASK_CACHE_BYTES = 128 * 1024 * 1024
// Full-canvas RGBA layer buffers add up quickly on large sources. Keep the most
// recently used ones under this budget; text layers are cheap and are not cached.
const LAYER_CACHE_BYTES = 192 * 1024 * 1024
// The scratch buffer is read back after every layer, so keep the CPU-backed hint.
const SCRATCH_READ_FREQUENTLY = true

type Pixels = Uint8ClampedArray<ArrayBuffer>

type LayerCacheEntry = { key: string; pixels: Pixels }

export type CompositionEngine = {
  // `source` is the cropped source image; `fontFor` resolves a preloaded font by
  // path. The result is written into the base canvas at `origin`, the top-left of
  // the content area inside the frame.
  render: (generation: Generation, source: Surface, fontFor: (path: string) => LoadedFont | undefined, origin: { x: number; y: number }) => void
  reset: () => void
}

function coversCanvas(shape: AreaShape): boolean {
  if (shape.kind !== 'rect' || shape.rotation !== 0 || shape.w <= 0 || shape.h <= 0) return false
  return shape.x <= 0 && shape.y <= 0 && shape.x + shape.w >= 1 && shape.y + shape.h >= 1
}

function usesMask(layer: EffectLayer): boolean {
  return !(coversCanvas(layer.shape) && layer.edge.feather <= 0 && layer.edge.jitter <= 0)
}

function layerRenderKey(layer: Layer): string {
  if (layer.kind === 'text') {
    return JSON.stringify([layer.id, layer.text, layer.align, layer.vAlign, layer.x, layer.y, layer.size, layer.font])
  }
  return JSON.stringify([layer.id, layer.effect, layer.params, layer.shape, layer.edge])
}

export function createCompositionEngine(base: Surface, wasm: WasmKernels): CompositionEngine {
  let width = 0
  let height = 0
  let scratch: Surface | null = null
  const maskCache = new Map<string, Float32Array | null>()
  const layerCache = new Map<string, LayerCacheEntry>()

  function reset() {
    maskCache.clear()
    layerCache.clear()
  }

  function ensureSize(nextWidth: number, nextHeight: number) {
    if (!scratch) {
      scratch = createSurface(nextWidth, nextHeight, { readFrequently: SCRATCH_READ_FREQUENTLY })
    } else {
      if (nextWidth === width && nextHeight === height) return
      resizeSurface(scratch, nextWidth, nextHeight)
    }
    width = nextWidth
    height = nextHeight
    reset()
  }

  function resetScratch() {
    if (scratch) resetSurface(scratch)
  }

  function scratchPixels(): Pixels {
    if (!scratch) return new Uint8ClampedArray(width * height * 4)
    return surfacePixels(scratch).data
  }

  function maskFor(layer: EffectLayer, generation: Generation, seed: number): Float32Array | null {
    if (!usesMask(layer)) return null
    const key = maskKey(layer.shape, layer.edge, width, height, seed, layer.id)
    if (maskCache.has(key)) return maskCache.get(key) ?? null
    const weights = maskWeightWasm(wasm, layer.shape, layer.edge, width, height, generation.seed, layer.id)
    maskCache.set(key, weights)
    if (maskCache.size * width * height * 4 > MASK_CACHE_BYTES) maskCache.clear()
    return weights
  }

  function renderLayer(
    layer: Layer,
    below: Pixels,
    generation: Generation,
    fontFor: (path: string) => LoadedFont | undefined,
  ): Pixels {
    resetScratch()
    if (!scratch) return new Uint8ClampedArray(width * height * 4)

    if (layer.kind === 'text') {
      const font = fontFor(layer.font)
      if (font) drawTextLayer(scratch.ctx, layer, font)
      return scratchPixels()
    }

    const seed = (generation.seed ^ hashString(layer.id)) >>> 0
    EFFECTS[layer.effect].render({
      ctx: scratch.ctx,
      width,
      height,
      source: new ImageData(below, width, height),
      mask: maskFor(layer, generation, generation.seed),
      seed,
      random: createRandom(seed),
      params: layer.params,
      edge: layer.edge,
      generation,
      wasm,
    })
    return scratchPixels()
  }

  function compositeLayer(result: Pixels, buffer: Pixels, layer: Layer, generation: Generation) {
    const opacity = Math.max(0, Math.min(100, layer.opacity)) / 100
    if (opacity <= 0) return
    const masked = layer.kind === 'effect' && usesMask(layer)
    const mask = masked && layer.kind === 'effect' ? maskFor(layer, generation, generation.seed) : null
    const ragged = masked && layer.kind === 'effect' && layer.edge.mode === 'ragged'
    const chunkPixels = Math.min(width * height, 1 << 20)
    const rgbaBytes = chunkPixels * 4
    wasm.pfree()
    const resultPtr = wasm.palloc(rgbaBytes) >>> 0
    const bufferPtr = wasm.palloc(rgbaBytes) >>> 0
    const maskPtr = mask ? wasm.palloc(chunkPixels * Float32Array.BYTES_PER_ELEMENT) >>> 0 : 0
    for (let start = 0; start < width * height; start += chunkPixels) {
      const count = Math.min(chunkPixels, width * height - start)
      const index = start * 4
      const byteLength = count * 4
      new Uint8Array(wasm.memory.buffer, resultPtr, byteLength).set(result.subarray(index, index + byteLength))
      new Uint8Array(wasm.memory.buffer, bufferPtr, byteLength).set(buffer.subarray(index, index + byteLength))
      if (mask) new Float32Array(wasm.memory.buffer, maskPtr, count).set(mask.subarray(start, start + count))
      measureWasm('compositeLayer', () => wasm.compositeLayer(
        resultPtr,
        bufferPtr,
        maskPtr,
        count,
        mask ? 1 : 0,
        ragged ? 1 : 0,
        opacity,
      ))
      result.set(new Uint8Array(wasm.memory.buffer, resultPtr, byteLength), index)
    }
  }

  function render(
    generation: Generation,
    source: Surface,
    fontFor: (path: string) => LoadedFont | undefined,
    origin: { x: number; y: number },
  ) {
    ensureSize(source.width, source.height)
    const result = source.ctx.getImageData(0, 0, source.width, source.height).data
    const solo = generation.soloLayerId
    const layers = generation.layers.filter((layer) => layer.visible && (!solo || layer.id === solo))
    // The hash chain stands in for the composite below each layer: an edit to a
    // lower layer invalidates every buffer above it, and nothing else.
    let sourceChain = hashString(`${generation.image}:${width}x${height}:${generation.seed}`)

    function cachedPixels(id: string, key: string): Pixels | null {
      const cached = layerCache.get(id)
      if (!cached || cached.key !== key) return null
      // Refresh insertion order so the cache evicts the least recently used buffer.
      layerCache.delete(id)
      layerCache.set(id, cached)
      return cached.pixels
    }

    function storePixels(id: string, key: string, pixels: Pixels) {
      layerCache.delete(id)
      layerCache.set(id, { key, pixels })
      let bytes = 0
      for (const entry of layerCache.values()) bytes += entry.pixels.length
      while (bytes > LAYER_CACHE_BYTES && layerCache.size > 1) {
        const oldest = layerCache.keys().next().value
        if (oldest === undefined) break
        const entry = layerCache.get(oldest)
        if (!entry) break
        bytes -= entry.pixels.length
        layerCache.delete(oldest)
      }
    }

    for (const layer of layers) {
      const renderKey = layerRenderKey(layer)
      const bufferKey = `${sourceChain}:${hashString(renderKey)}`
      let pixels: Pixels
      if (layer.kind === 'text') {
        // Rasterizing text is cheap; caching a full transparent canvas for it is not.
        layerCache.delete(layer.id)
        pixels = renderLayer(layer, result, generation, fontFor)
      } else {
        const cached = cachedPixels(layer.id, bufferKey)
        if (cached) {
          pixels = cached
        } else {
          pixels = renderLayer(layer, result, generation, fontFor)
          storePixels(layer.id, bufferKey, pixels)
        }
      }
      compositeLayer(result, pixels, layer, generation)
      // Opacity changes do not re-render this layer, but they change the source
      // every layer above it samples.
      sourceChain = hashString(`${bufferKey}:${layer.opacity}`)
    }

    const live = new Set(layers.map((layer) => layer.id))
    for (const id of [...layerCache.keys()]) if (!live.has(id)) layerCache.delete(id)

    base.ctx.putImageData(new ImageData(result, width, height), origin.x, origin.y)
  }

  return { render, reset }
}

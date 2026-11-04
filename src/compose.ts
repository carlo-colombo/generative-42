import p5 from 'p5'
import { hashString, maskKey, maskWeight } from './areas'
import { EFFECTS } from './effects'
import { drawTextLayer } from './text'
import type { AreaShape, EffectLayer, Generation, Layer } from './types'

// Per-mask cache budget; past it the cache is dropped rather than grown.
const MASK_CACHE_BYTES = 64 * 1024 * 1024
// Full-canvas RGBA layer buffers add up quickly on large sources. Keep the most
// recently used ones under this budget; text layers are cheap and are not cached.
const LAYER_CACHE_BYTES = 192 * 1024 * 1024

type LayerCacheEntry = { key: string; pixels: Uint8ClampedArray }

export type CompositionEngine = {
  // `source` is the cropped source image at canvas size; `fontFor` resolves a
  // preloaded p5 font by path.
  render: (generation: Generation, source: p5.Image, fontFor: (path: string) => p5.Font | undefined) => void
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

export function createCompositionEngine(renderer: p5): CompositionEngine {
  let width = 0
  let height = 0
  let scratch: p5.Graphics | null = null
  let output: p5.Image | null = null
  const maskCache = new Map<string, Float32Array | null>()
  const layerCache = new Map<string, LayerCacheEntry>()

  function reset() {
    maskCache.clear()
    layerCache.clear()
  }

  function ensureSize(nextWidth: number, nextHeight: number) {
    if (scratch && output && nextWidth === width && nextHeight === height) return
    width = nextWidth
    height = nextHeight
    scratch?.remove()
    scratch = renderer.createGraphics(width, height)
    scratch.pixelDensity(1)
    output = renderer.createImage(width, height)
    reset()
  }

  function resetScratch() {
    const target = scratch
    if (!target) return
    target.clear()
    target.resetMatrix()
    target.rectMode(target.CORNER)
    target.ellipseMode(target.CENTER)
    target.imageMode(target.CORNER)
    target.blendMode(target.BLEND)
    target.noTint()
    target.noStroke()
    target.noFill()
    target.strokeWeight(1)
  }

  function scratchPixels(): Uint8ClampedArray {
    const target = scratch
    if (!target) return new Uint8ClampedArray(width * height * 4)
    target.loadPixels()
    return new Uint8ClampedArray(target.pixels as unknown as Uint8ClampedArray)
  }

  function imageFromPixels(pixels: Uint8ClampedArray): p5.Image {
    const image = renderer.createImage(width, height)
    image.loadPixels()
    ;(image.pixels as unknown as Uint8ClampedArray).set(pixels)
    image.updatePixels()
    return image
  }

  function maskFor(layer: EffectLayer, generation: Generation, seed: number): Float32Array | null {
    if (!usesMask(layer)) return null
    const key = maskKey(layer.shape, layer.edge, width, height, seed, layer.id)
    if (maskCache.has(key)) return maskCache.get(key) ?? null
    // maskWeight reuses one scratch buffer, so keep a copy before anything else runs.
    const weights = new Float32Array(maskWeight(layer.shape, layer.edge, width, height, generation.seed, layer.id))
    maskCache.set(key, weights)
    if (maskCache.size * width * height * 4 > MASK_CACHE_BYTES) maskCache.clear()
    return weights
  }

  function renderLayer(
    layer: Layer,
    below: Uint8ClampedArray,
    generation: Generation,
    fontFor: (path: string) => p5.Font | undefined,
  ): Uint8ClampedArray {
    resetScratch()
    const target = scratch
    if (!target) return new Uint8ClampedArray(width * height * 4)

    if (layer.kind === 'text') {
      const font = fontFor(layer.font)
      if (font) drawTextLayer(target, layer, font)
      return scratchPixels()
    }

    const seed = (generation.seed ^ hashString(layer.id)) >>> 0
    target.randomSeed(seed)
    target.noiseSeed(seed)
    EFFECTS[layer.effect].render({
      p: target,
      source: imageFromPixels(below),
      mask: maskFor(layer, generation, generation.seed),
      seed,
      params: layer.params,
      edge: layer.edge,
      generation,
    })
    return scratchPixels()
  }

  function compositeLayer(result: Uint8ClampedArray, buffer: Uint8ClampedArray, layer: Layer, generation: Generation) {
    const opacity = Math.max(0, Math.min(100, layer.opacity)) / 100
    if (opacity <= 0) return
    const masked = layer.kind === 'effect' && usesMask(layer)
    const mask = masked && layer.kind === 'effect' ? maskFor(layer, generation, generation.seed) : null
    const ragged = masked && layer.kind === 'effect' && layer.edge.mode === 'ragged'
    for (let pixel = 0, index = 0; pixel < width * height; pixel++, index += 4) {
      // Effect sprites and glyphs are transparent outside what they paint, so the
      // buffer always composites by alpha; the mask and opacity gate that alpha.
      const weight = mask ? mask[pixel] : 1
      if (weight <= 0) continue
      const layerAlpha = (buffer[index + 3] / 255) * opacity * (ragged ? 1 : weight)
      if (layerAlpha <= 0) continue
      const baseAlpha = result[index + 3] / 255
      if (layerAlpha >= 1) {
        result[index] = buffer[index]
        result[index + 1] = buffer[index + 1]
        result[index + 2] = buffer[index + 2]
        result[index + 3] = buffer[index + 3]
        continue
      }
      const outAlpha = layerAlpha + baseAlpha * (1 - layerAlpha)
      if (outAlpha <= 0) {
        result[index] = 0
        result[index + 1] = 0
        result[index + 2] = 0
        result[index + 3] = 0
        continue
      }
      result[index] = (buffer[index] * layerAlpha + result[index] * baseAlpha * (1 - layerAlpha)) / outAlpha
      result[index + 1] = (buffer[index + 1] * layerAlpha + result[index + 1] * baseAlpha * (1 - layerAlpha)) / outAlpha
      result[index + 2] = (buffer[index + 2] * layerAlpha + result[index + 2] * baseAlpha * (1 - layerAlpha)) / outAlpha
      result[index + 3] = outAlpha * 255
    }
  }

  function render(generation: Generation, source: p5.Image, fontFor: (path: string) => p5.Font | undefined) {
    ensureSize(source.width, source.height)
    source.loadPixels()
    const result = new Uint8ClampedArray(source.pixels as unknown as Uint8ClampedArray)
    const solo = generation.soloLayerId
    const layers = generation.layers.filter((layer) => layer.visible && (!solo || layer.id === solo))
    // The hash chain stands in for the composite below each layer: an edit to a
    // lower layer invalidates every buffer above it, and nothing else.
    let sourceChain = hashString(`${generation.image}:${width}x${height}:${generation.seed}`)

    function cachedPixels(id: string, key: string): Uint8ClampedArray | null {
      const cached = layerCache.get(id)
      if (!cached || cached.key !== key) return null
      // Refresh insertion order so the cache evicts the least recently used buffer.
      layerCache.delete(id)
      layerCache.set(id, cached)
      return cached.pixels
    }

    function storePixels(id: string, key: string, pixels: Uint8ClampedArray) {
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
      let pixels: Uint8ClampedArray
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

    if (!output) output = renderer.createImage(width, height)
    output.loadPixels()
    ;(output.pixels as unknown as Uint8ClampedArray).set(result)
    output.updatePixels()

    renderer.clear()
    renderer.image(output, 0, 0)
  }

  return { render, reset }
}

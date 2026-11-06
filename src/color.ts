import { measureWasm, type WasmKernels } from './wasm'

type ScalingSurfaces = {
  sourceCanvas: HTMLCanvasElement
  sourceCtx: CanvasRenderingContext2D
  scaledCanvas: HTMLCanvasElement
  scaledCtx: CanvasRenderingContext2D
}

let scalingSurfaces: ScalingSurfaces | null = null

function getScalingSurfaces(
  sourceWidth: number,
  sourceHeight: number,
  scaledWidth: number,
  scaledHeight: number,
): ScalingSurfaces {
  if (!scalingSurfaces) {
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = sourceWidth
    sourceCanvas.height = sourceHeight
    const sourceCtx = sourceCanvas.getContext('2d')
    if (!sourceCtx) throw new Error(`Missing 2D context for a ${sourceWidth}x${sourceHeight} scratch canvas`)
    const scaledCanvas = document.createElement('canvas')
    scaledCanvas.width = scaledWidth
    scaledCanvas.height = scaledHeight
    const scaledCtx = scaledCanvas.getContext('2d', { willReadFrequently: true })
    if (!scaledCtx) throw new Error(`Missing 2D context for a ${scaledWidth}x${scaledHeight} scaled canvas`)
    scalingSurfaces = { sourceCanvas, sourceCtx, scaledCanvas, scaledCtx }
  } else {
    if (scalingSurfaces.sourceCanvas.width !== sourceWidth) scalingSurfaces.sourceCanvas.width = sourceWidth
    if (scalingSurfaces.sourceCanvas.height !== sourceHeight) scalingSurfaces.sourceCanvas.height = sourceHeight
    if (scalingSurfaces.scaledCanvas.width !== scaledWidth) scalingSurfaces.scaledCanvas.width = scaledWidth
    if (scalingSurfaces.scaledCanvas.height !== scaledHeight) scalingSurfaces.scaledCanvas.height = scaledHeight
  }
  return scalingSurfaces
}

function downscale(source: ImageData, width: number, height: number): Uint8ClampedArray {
  const surfaces = getScalingSurfaces(source.width, source.height, width, height)
  surfaces.sourceCtx.putImageData(source, 0, 0)
  surfaces.scaledCtx.imageSmoothingEnabled = true
  surfaces.scaledCtx.drawImage(surfaces.sourceCanvas, 0, 0, width, height)
  return surfaces.scaledCtx.getImageData(0, 0, width, height).data
}

export function sampleQuads(
  source: ImageData,
  coordinates: Float32Array,
  wasm: WasmKernels,
  maxDim = 1000,
): Uint8Array {
  const count = coordinates.length / 8
  const longest = Math.max(source.width, source.height)
  let pixels: Uint8ClampedArray = source.data
  let width = source.width
  let height = source.height
  let scale = 1
  if (longest > maxDim) {
    scale = maxDim / longest
    width = Math.max(1, Math.round(source.width * scale))
    height = Math.max(1, Math.round(source.height * scale))
    pixels = downscale(source, width, height)
  }
  const byteLength = pixels.length
  wasm.pfree()
  const sourcePtr = wasm.palloc(byteLength) >>> 0
  const quadsPtr = wasm.palloc(coordinates.length * Float32Array.BYTES_PER_ELEMENT) >>> 0
  const colorsPtr = wasm.palloc(count * 3) >>> 0
  new Uint8Array(wasm.memory.buffer, sourcePtr, byteLength).set(pixels)
  const quads = new Float32Array(wasm.memory.buffer, quadsPtr, coordinates.length)
  for (let i = 0; i < coordinates.length; i++) quads[i] = coordinates[i] * scale
  measureWasm('sampleQuads', () => wasm.sampleQuads(sourcePtr, width, height, quadsPtr, count, colorsPtr))
  return new Uint8Array(wasm.memory.buffer, colorsPtr, count * 3).slice()
}

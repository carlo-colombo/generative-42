import p5 from 'p5'
import { measureWasm, type WasmKernels } from './wasm'

type ScaledImage = {
  canvas: HTMLCanvasElement
  scale: number
  maxDim: number
}

const scaledCache = new WeakMap<p5.Image, ScaledImage>()

function imageToCanvas(img: p5.Image): HTMLCanvasElement {
  return (img as unknown as { canvas: HTMLCanvasElement }).canvas
}

function getScaled(img: p5.Image, maxDim: number): ScaledImage {
  const cached = scaledCache.get(img)
  if (cached && cached.maxDim === maxDim) return cached
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  let entry: ScaledImage
  if (scale === 1) {
    entry = { canvas: imageToCanvas(img), scale: 1, maxDim }
  } else {
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(imageToCanvas(img), 0, 0, width, height)
    entry = { canvas, scale, maxDim }
  }
  scaledCache.set(img, entry)
  return entry
}

export function sampleQuads(
  img: p5.Image,
  coordinates: Float32Array,
  wasm: WasmKernels,
  maxDim = 1000,
): Uint8Array {
  const count = coordinates.length / 8
  const { canvas, scale } = getScaled(img, maxDim)
  const source = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  const byteLength = source.length
  wasm.pfree()
  const sourcePtr = wasm.palloc(byteLength) >>> 0
  const quadsPtr = wasm.palloc(coordinates.length * Float32Array.BYTES_PER_ELEMENT) >>> 0
  const colorsPtr = wasm.palloc(count * 3) >>> 0
  new Uint8Array(wasm.memory.buffer, sourcePtr, byteLength).set(source)
  const quads = new Float32Array(wasm.memory.buffer, quadsPtr, coordinates.length)
  for (let i = 0; i < coordinates.length; i++) quads[i] = coordinates[i] * scale
  measureWasm('sampleQuads', () => wasm.sampleQuads(sourcePtr, canvas.width, canvas.height, quadsPtr, count, colorsPtr))
  return new Uint8Array(wasm.memory.buffer, colorsPtr, count * 3).slice()
}

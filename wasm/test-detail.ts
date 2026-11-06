import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mulberry32 } from '../src/areas'

const { instance } = await WebAssembly.instantiate(readFileSync(new URL('../public/wasm/kernels.wasm', import.meta.url)), {})
const wasm = instance.exports as unknown as {
  memory: WebAssembly.Memory
  palloc: (bytes: number) => number
  pfree: () => void
  detailNoise: (source: number, target: number, width: number, height: number, colorMode: number, seed: number) => void
}

const width = 29
const height = 23
const bytes = width * height * 4
const source = new Uint8ClampedArray(bytes)
const random = mulberry32(34)
for (let i = 0; i < bytes; i += 4) {
  source[i] = Math.floor(random() * 256)
  source[i + 1] = Math.floor(random() * 256)
  source[i + 2] = Math.floor(random() * 256)
  source[i + 3] = 255
}

const radius = Math.max(1, Math.round(Math.min(width, height) / 80))
const luminance = new Float64Array(width * height)
for (let i = 0; i < luminance.length; i++) {
  const pixel = i * 4
  luminance[i] = Math.round(0.299 * source[pixel] + 0.587 * source[pixel + 1] + 0.114 * source[pixel + 2])
}
const details = new Float64Array(width * height)
let maxDetail = 1e-6
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    let sum = 0
    let sumSquares = 0
    let count = 0
    for (let yy = Math.max(0, y - radius); yy < Math.min(height, y + radius + 1); yy++) {
      for (let xx = Math.max(0, x - radius); xx < Math.min(width, x + radius + 1); xx++) {
        const value = luminance[yy * width + xx]
        sum += value
        sumSquares += value * value
        count++
      }
    }
    const mean = sum / count
    const detail = Math.sqrt(Math.max(0, sumSquares / count - mean * mean))
    details[y * width + x] = detail
    maxDetail = Math.max(maxDetail, detail)
  }
}
const expected = new Uint8ClampedArray(bytes)
const poissonTable = new Uint8Array(65536)
for (let i = 0; i < poissonTable.length; i++) {
  const sample = (i + 0.5) / poissonTable.length
  let probability = Math.exp(-8)
  let cumulative = probability
  let count = 0
  while (sample > cumulative && count < 32) {
    count++
    probability *= 8 / count
    cumulative += probability
  }
  poissonTable[i] = count
}
const noiseRandom = mulberry32(881)
for (let i = 0; i < width * height; i++) {
  const count = poissonTable[Math.min(poissonTable.length - 1, Math.floor(noiseRandom() * poissonTable.length))]
  const value = count / 8 * details[i] / maxDetail
  const channel = Math.max(0, Math.min(255, Math.round(value * 255)))
  expected.set([channel, channel, channel, 255], i * 4)
}

wasm.pfree()
const sourcePtr = wasm.palloc(bytes) >>> 0
const outputPtr = wasm.palloc(bytes) >>> 0
new Uint8Array(wasm.memory.buffer, sourcePtr, bytes).set(source)
wasm.detailNoise(sourcePtr, outputPtr, width, height, 0, 881)
assert.deepEqual([...new Uint8Array(wasm.memory.buffer, outputPtr, bytes)], [...expected])
console.log('WASM detail noise matches the seeded reference test')

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const { instance } = await WebAssembly.instantiate(readFileSync(new URL('../public/wasm/kernels.wasm', import.meta.url)), {})
const wasm = instance.exports
assert.equal(wasm.curtainGrid instanceof Function, true)
assert.equal(wasm.compositeLayer instanceof Function, true)
assert.equal(wasm.detailNoise instanceof Function, true)
assert.equal(wasm.pixelSort instanceof Function, true)
assert.equal(wasm.voronoiCells instanceof Function, true)
assert.equal(wasm.sampleQuads instanceof Function, true)
assert.equal(wasm.pixelFilter instanceof Function, true)

const width = 160
const height = 120
const bytes = width * height * 4
const source = new Uint8Array(bytes)
for (let i = 0; i < bytes; i += 4) {
  const pixel = i / 4
  source[i] = (pixel * 17) & 255
  source[i + 1] = (pixel * 31) & 255
  source[i + 2] = (pixel * 53) & 255
  source[i + 3] = 255
}

function render() {
  wasm.pfree()
  const src = wasm.palloc(bytes) >>> 0
  const out = wasm.palloc(bytes) >>> 0
  new Uint8Array(wasm.memory.buffer, src, bytes).set(source)
  wasm.curtainGrid(src, out, width, height, 16, 8, 2, 35, 40, 35, 0, 2, 123)
  return new Uint8Array(wasm.memory.buffer, out, bytes).slice()
}

const first = render()
const second = render()
assert.deepEqual(first, second, 'curtain output should be deterministic for a seed')
assert.equal(first.length, bytes)
assert.ok(first.some((v, i) => i % 4 === 3 && v === 255), 'curtain render should write opaque pixels')

wasm.pfree()
const testPixels = wasm.palloc(8) >>> 0
new Uint8Array(wasm.memory.buffer, testPixels, 8).set([10, 20, 30, 255, 100, 150, 200, 0])
wasm.pixelFilter(testPixels, 2, 1, 0)
assert.deepEqual([...new Uint8Array(wasm.memory.buffer, testPixels, 8)], [245, 235, 225, 255, 155, 105, 55, 0])

wasm.pfree()
const sampleWidth = 4
const sampleHeight = 3
const sampleSourcePtr = wasm.palloc(sampleWidth * sampleHeight * 4) >>> 0
const sampleQuadsPtr = wasm.palloc(8 * Float32Array.BYTES_PER_ELEMENT) >>> 0
const sampleOutPtr = wasm.palloc(3) >>> 0
const sampleSource = new Uint8Array(wasm.memory.buffer, sampleSourcePtr, sampleWidth * sampleHeight * 4)
for (let y = 0; y < sampleHeight; y++) {
  for (let x = 0; x < sampleWidth; x++) {
    const i = (y * sampleWidth + x) * 4
    sampleSource[i] = x + y * 10
    sampleSource[i + 1] = x + y * 20
    sampleSource[i + 2] = x + y * 30
    sampleSource[i + 3] = 255
  }
}
new Float32Array(wasm.memory.buffer, sampleQuadsPtr, 8).set([0, 0, 1, 0, 0, 1, 1, 1])
wasm.sampleQuads(sampleSourcePtr, sampleWidth, sampleHeight, sampleQuadsPtr, 1, sampleOutPtr)
assert.deepEqual([...new Uint8Array(wasm.memory.buffer, sampleOutPtr, 3)], [6, 11, 16])

wasm.pfree()
const resultPtr = wasm.palloc(8) >>> 0
const bufferPtr = wasm.palloc(8) >>> 0
const maskPtr = wasm.palloc(8) >>> 0
new Uint8Array(wasm.memory.buffer, resultPtr, 8).set([20, 40, 60, 255, 0, 0, 0, 0])
new Uint8Array(wasm.memory.buffer, bufferPtr, 8).set([200, 100, 50, 128, 80, 120, 160, 255])
new Float32Array(wasm.memory.buffer, maskPtr, 2).set([0.5, 1])
wasm.compositeLayer(resultPtr, bufferPtr, maskPtr, 2, 1, 0, 0.5)
const blended = [...new Uint8Array(wasm.memory.buffer, resultPtr, 8)]
assert.deepEqual(blended.slice(0, 4), [43, 48, 59, 255])
assert.deepEqual(blended.slice(4), [80, 120, 160, 128])

console.log('WASM kernels: filters, sampling, composition, and curtain determinism')

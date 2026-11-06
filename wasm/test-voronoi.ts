import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { instance } = await WebAssembly.instantiate(readFileSync(new URL('../public/wasm/kernels.wasm', import.meta.url)), {})
const wasm = instance.exports as unknown as {
  memory: WebAssembly.Memory
  palloc: (bytes: number) => number
  pfree: () => void
  poissonSites: (width: number, height: number, target: number, seed: number, xs: number, ys: number, minDistance: number, count: number) => void
  voronoiCells: (source: number, target: number, width: number, height: number, xs: number, ys: number, count: number, minDistance: number) => void
}

wasm.pfree()
const siteTarget = 40
const siteXsPtr = wasm.palloc(siteTarget * 4) >>> 0
const siteYsPtr = wasm.palloc(siteTarget * 4) >>> 0
const siteDistancePtr = wasm.palloc(4) >>> 0
const siteCountPtr = wasm.palloc(4) >>> 0
wasm.poissonSites(100, 80, siteTarget, 99, siteXsPtr, siteYsPtr, siteDistancePtr, siteCountPtr)
const siteCount = new Uint32Array(wasm.memory.buffer, siteCountPtr, 1)[0]
const minDistance = new Float32Array(wasm.memory.buffer, siteDistancePtr, 1)[0]
const sampledXs = new Float32Array(wasm.memory.buffer, siteXsPtr, siteCount).slice()
const sampledYs = new Float32Array(wasm.memory.buffer, siteYsPtr, siteCount).slice()
assert.ok(siteCount > 0)
for (let i = 0; i < siteCount; i++) {
  assert.ok(sampledXs[i] >= 0 && sampledXs[i] < 100)
  assert.ok(sampledYs[i] >= 0 && sampledYs[i] < 80)
  for (let j = 0; j < i; j++) {
    const dx = sampledXs[i] - sampledXs[j]
    const dy = sampledYs[i] - sampledYs[j]
    assert.ok(dx * dx + dy * dy >= minDistance * minDistance - 1e-3)
  }
}
wasm.pfree()
const repeatXsPtr = wasm.palloc(siteTarget * 4) >>> 0
const repeatYsPtr = wasm.palloc(siteTarget * 4) >>> 0
const repeatDistancePtr = wasm.palloc(4) >>> 0
const repeatCountPtr = wasm.palloc(4) >>> 0
wasm.poissonSites(100, 80, siteTarget, 99, repeatXsPtr, repeatYsPtr, repeatDistancePtr, repeatCountPtr)
assert.equal(new Uint32Array(wasm.memory.buffer, repeatCountPtr, 1)[0], siteCount)
assert.deepEqual([...new Float32Array(wasm.memory.buffer, repeatXsPtr, siteCount)], [...sampledXs])
assert.deepEqual([...new Float32Array(wasm.memory.buffer, repeatYsPtr, siteCount)], [...sampledYs])

const width = 8
const height = 5
const bytes = width * height * 4
const source = new Uint8Array(bytes)
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    source[i] = x * 20
    source[i + 1] = y * 30
    source[i + 2] = x * 5 + y * 7
    source[i + 3] = 255
  }
}
const xs = new Float32Array([1, 6])
const ys = new Float32Array([2, 2])
const owners = new Uint8Array(width * height)
const sums = [[0, 0, 0], [0, 0, 0]]
const counts = [0, 0]
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const site = Math.abs(x - xs[0]) <= Math.abs(x - xs[1]) ? 0 : 1
    const i = y * width + x
    owners[i] = site
    counts[site]++
    sums[site][0] += source[i * 4]
    sums[site][1] += source[i * 4 + 1]
    sums[site][2] += source[i * 4 + 2]
  }
}
const expected = new Uint8Array(bytes)
for (let i = 0; i < owners.length; i++) {
  const site = owners[i]
  expected.set([
    Math.round(sums[site][0] / counts[site]),
    Math.round(sums[site][1] / counts[site]),
    Math.round(sums[site][2] / counts[site]),
    255,
  ], i * 4)
}

wasm.pfree()
const sourcePtr = wasm.palloc(bytes) >>> 0
const targetPtr = wasm.palloc(bytes) >>> 0
const xsPtr = wasm.palloc(xs.byteLength) >>> 0
const ysPtr = wasm.palloc(ys.byteLength) >>> 0
const memory = wasm.memory.buffer
new Uint8Array(memory, sourcePtr, bytes).set(source)
new Float32Array(memory, xsPtr, 2).set(xs)
new Float32Array(memory, ysPtr, 2).set(ys)
wasm.voronoiCells(sourcePtr, targetPtr, width, height, xsPtr, ysPtr, 2, 4)
assert.deepEqual([...new Uint8Array(wasm.memory.buffer, targetPtr, bytes)], [...expected])
console.log('WASM Voronoi cells match the nearest-site reference test')

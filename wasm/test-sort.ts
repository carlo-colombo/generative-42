import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sortPixels } from '../src/sort'
import { mulberry32 } from '../src/areas'

const { instance } = await WebAssembly.instantiate(readFileSync(new URL('../public/wasm/kernels.wasm', import.meta.url)), {})
const wasm = instance.exports as unknown as {
  memory: WebAssembly.Memory
  palloc: (bytes: number) => number
  pfree: () => void
  pixelSort: (
    source: number, target: number, mask: number, width: number, height: number,
    hasMask: number, direction: number, reverse: number, randomness: number,
    spanWidth: number, contained: number, jitter: number, amountEnabled: number,
    amount: number, seed: number,
  ) => void
}

const width = 37
const height = 29
const bytes = width * height * 4
const source = new Uint8ClampedArray(bytes)
const random = mulberry32(9321)
for (let i = 0; i < bytes; i++) source[i] = Math.floor(random() * 256)
const weight = new Float32Array(width * height)
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    weight[y * width + x] = (x > 3 && x < width - 4 && (y % 5 !== 0 || x % 3 === 0)) ? 1 : 0
  }
}

const cases = [
  { direction: 'horizontal' as const, reverse: false, randomness: 0, spanWidth: 1, containedBlocks: false, jitter: 0, amount: null },
  { direction: 'vertical' as const, reverse: true, randomness: 40, spanWidth: 1, containedBlocks: false, jitter: 15, amount: 64 },
  { direction: 'horizontal' as const, reverse: true, randomness: 10, spanWidth: 7, containedBlocks: true, jitter: 35, amount: 73 },
  { direction: 'vertical' as const, reverse: false, randomness: 90, spanWidth: 4, containedBlocks: true, jitter: 0, amount: 28 },
  { direction: 'horizontal' as const, reverse: false, randomness: 0, spanWidth: 64, containedBlocks: false, jitter: 0, amount: 100 },
]

for (const [index, options] of cases.entries()) {
  const expected = sortPixels(source, width, height, weight, {
    ...options,
    amount: options.amount,
  }, mulberry32(index + 81))

  wasm.pfree()
  const srcPtr = wasm.palloc(bytes) >>> 0
  const outPtr = wasm.palloc(bytes) >>> 0
  const maskPtr = wasm.palloc(weight.length) >>> 0
  const memory = wasm.memory.buffer
  new Uint8Array(memory, srcPtr, bytes).set(source)
  const mask = new Uint8Array(memory, maskPtr, weight.length)
  for (let i = 0; i < weight.length; i++) mask[i] = weight[i] > 0 ? 1 : 0
  wasm.pixelSort(
    srcPtr, outPtr, maskPtr, width, height, 1,
    options.direction === 'horizontal' ? 0 : 1,
    options.reverse ? 1 : 0,
    options.randomness,
    options.spanWidth,
    options.containedBlocks ? 1 : 0,
    options.jitter,
    options.amount === null ? 0 : 1,
    options.amount ?? 100,
    index + 81,
  )
  assert.deepEqual([...new Uint8Array(wasm.memory.buffer, outPtr, bytes)], [...expected], `sort case ${index}`)
}

console.log('WASM pixel sort matches the seeded reference test cases')

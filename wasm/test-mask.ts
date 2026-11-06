import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { maskWeightWasm } from '../src/masks'
import type { WasmKernels } from '../src/wasm'

const { instance } = await WebAssembly.instantiate(readFileSync(new URL('../public/wasm/kernels.wasm', import.meta.url)), {})
const wasm = instance.exports as unknown as WasmKernels
const edge = { feather: 0, jitter: 0, mode: 'blend' as const }
const rect = { kind: 'rect' as const, x: 0.25, y: 0.25, w: 0.5, h: 0.5, rotation: 0 }
const rectMask = maskWeightWasm(wasm, rect, edge, 4, 4, 1, 'rect')
assert.deepEqual([...rectMask], [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0])

const ellipse = { kind: 'ellipse' as const, cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, rotation: 0 }
const ellipseMask = maskWeightWasm(wasm, ellipse, edge, 4, 4, 1, 'ellipse')
assert.deepEqual([...ellipseMask], [...rectMask])

const path = {
  kind: 'path' as const,
  closed: true,
  side: 'a' as const,
  tension: 0,
  points: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.5, y: 0.75 }],
}
const pathMask = maskWeightWasm(wasm, path, edge, 4, 4, 1, 'path')
assert.deepEqual([...pathMask], [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])

const feathered = maskWeightWasm(wasm, rect, { feather: 20, jitter: 15, mode: 'ragged' }, 64, 48, 5, 'feathered')
const repeat = maskWeightWasm(wasm, rect, { feather: 20, jitter: 15, mode: 'ragged' }, 64, 48, 5, 'feathered')
assert.deepEqual([...feathered], [...repeat])
assert.ok(feathered.some(value => value > 0 && value < 1))
assert.ok(feathered.every(value => value >= 0 && value <= 1))
const pathFeathered = maskWeightWasm(wasm, path, { feather: 12, jitter: 8, mode: 'ragged' }, 64, 48, 8, 'path')
assert.ok(pathFeathered.some(value => value > 0 && value < 1))
assert.ok(pathFeathered.every(value => value >= 0 && value <= 1))
console.log('WASM masks: rect, ellipse, path, feather, and jitter')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { instance } = await WebAssembly.instantiate(readFileSync(new URL('../public/wasm/kernels.wasm', import.meta.url)), {})
const wasm = instance.exports as unknown as {
  memory: WebAssembly.Memory
  palloc: (bytes: number) => number
  pfree: () => void
  artisticFilter: (source: number, target: number, width: number, height: number, filter: number, param1: number, param2: number, colorA: number, colorB: number, seed: number) => void
}

const width = 19
const height = 13
const bytes = width * height * 4
const source = new Uint8Array(bytes)
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    source[i] = (x * 37 + y * 19) & 255
    source[i + 1] = (x * 13 + y * 47) & 255
    source[i + 2] = (x * 53 + y * 7) & 255
    source[i + 3] = x === 0 && y === 0 ? 0 : 255
  }
}

const cases = [
  [1, 6, 30],
  [2, 4, 100],
  [3, 20, 0],
  [4, 3, 50],
  [5, 7, 20],
  [6, 0, 0],
  [7, 8, 50],
] as const

for (const [filter, param1, param2] of cases) {
  wasm.pfree()
  const src = wasm.palloc(bytes) >>> 0
  const out = wasm.palloc(bytes) >>> 0
  new Uint8Array(wasm.memory.buffer, src, bytes).set(source)
  const render = () => {
    wasm.artisticFilter(src, out, width, height, filter, param1, param2, 0x172554, 0xfef3c7, 441)
    return new Uint8Array(wasm.memory.buffer, out, bytes).slice()
  }
  const first = render()
  const second = render()
  assert.deepEqual(first, second, `filter ${filter} should be deterministic`)
  assert.notDeepEqual(first, source, `filter ${filter} should change the source`)
  if (filter === 4 || filter === 5 || filter === 7) {
    for (let i = 3; i < bytes; i += 4) assert.ok(first[i] === 0 || first[i] === 255, `filter ${filter} should keep sampled alpha values`)
  } else {
    for (let i = 3; i < bytes; i += 4) assert.equal(first[i], source[i], `filter ${filter} should preserve alpha`)
  }
  if (filter === 5 || filter === 7) {
    const expected = new Uint8Array(bytes)
    const centerX = (width - 1) / 2
    const centerY = (height - 1) / 2
    const sample = (x: number, y: number) => {
      const sx = Math.max(0, Math.min(width - 1, x))
      const sy = Math.max(0, Math.min(height - 1, y))
      const offset = (sy * width + sx) * 4
      return source.subarray(offset, offset + 4)
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX
        const dy = y - centerY
        let pixel: Uint8Array
        if (filter === 5) {
          const radius = Math.sqrt(dx * dx + dy * dy)
          const sector = 2 * Math.PI / param1
          const rotation = param2 * Math.PI / 180
          const angle = Math.atan2(dy, dx) + rotation
          let folded = angle - Math.floor(angle / sector) * sector
          if (folded > sector / 2) folded = sector - folded
          pixel = sample(
            Math.floor(centerX + radius * Math.cos(folded - rotation) + 0.5),
            Math.floor(centerY + radius * Math.sin(folded - rotation) + 0.5),
          )
        } else {
          const radius = Math.sqrt(dx * dx + dy * dy)
          const displacement = Math.sin(radius / Math.min(width, height) * param1 * 2 * Math.PI)
            * Math.min(width, height) * 0.08 * param2 / 100
          const scale = radius > 0 ? (radius + displacement) / radius : 1
          pixel = sample(Math.floor(centerX + dx * scale + 0.5), Math.floor(centerY + dy * scale + 0.5))
        }
        expected.set(pixel, (y * width + x) * 4)
      }
    }
    assert.deepEqual(first, expected, `filter ${filter} should match its reference mapping`)
  }
}

console.log('WASM artistic filters are deterministic and preserve alpha')

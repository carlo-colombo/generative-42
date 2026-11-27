import assert from 'node:assert/strict'
import { pixelSortV2Mask } from '../src/pixel-sort-v2'

function maskOf(width: number, height: number) {
  return new Float32Array(width * height).fill(1)
}

function horizontalEdges(mask: Float32Array, width: number, height: number) {
  return Array.from({ length: height }, (_, y) => {
    const row = mask.subarray(y * width, (y + 1) * width)
    const start = row.findIndex((value) => value > 0)
    const end = row.findLastIndex((value) => value > 0)
    return [start, end] as const
  })
}

const width = 1000
const height = 64
const full = maskOf(width, height)
const unchanged = pixelSortV2Mask(full.slice(), width, height, 'horizontal', 0, 0, 1, 10, 'random', 123)
assert.deepEqual(unchanged, full)

const leftOnly = horizontalEdges(pixelSortV2Mask(full.slice(), width, height, 'horizontal', 10, 0, 1, 10, 'random', 123), width, height)
assert(leftOnly.every(([, end]) => end === 999), 'zero end randomness keeps the last pixel selected')
const rightOnly = horizontalEdges(pixelSortV2Mask(full.slice(), width, height, 'horizontal', 0, 20, 1, 10, 'random', 123), width, height)
assert(rightOnly.every(([start]) => start === 0), 'zero start randomness keeps the first pixel selected')

const random = pixelSortV2Mask(full.slice(), width, height, 'horizontal', 10, 20, 1, 10, 'random', 123)
const randomEdges = horizontalEdges(random, width, height)
for (const [start, end] of randomEdges) {
  assert(start >= 0 && start <= 99, `start ${start} is within first 10%`)
  assert(end >= 800 && end <= 999, `end ${end} is within last 20%`)
}

const sized = pixelSortV2Mask(full.slice(), width, height, 'horizontal', 10, 20, 10, 10, 'random', 123)
for (const [start, end] of horizontalEdges(sized, width, height)) {
  assert(start >= 0 && start <= 90 && start % 10 === 0, `pixel-sized start ${start}`)
  assert(end >= 809 && end <= 999 && (end + 1) % 10 === 0, `pixel-sized end ${end}`)
}

const smooth = pixelSortV2Mask(full.slice(), width, height, 'horizontal', 10, 20, 1, 10, '1d', 123)
const smoother = pixelSortV2Mask(full.slice(), width, height, 'horizontal', 10, 20, 1, 50, '1d', 123)
assert.deepEqual(smooth, pixelSortV2Mask(full.slice(), width, height, 'horizontal', 10, 20, 1, 10, '1d', 123))
const variation = (edges: readonly (readonly [number, number])[]) =>
  edges.slice(1).reduce((sum, edge, index) => sum + Math.abs(edge[0] - edges[index][0]) + Math.abs(edge[1] - edges[index][1]), 0)
assert(variation(horizontalEdges(smooth, width, height)) < variation(randomEdges), '1D noise is smoother than random')
assert(variation(horizontalEdges(smoother, width, height)) < variation(horizontalEdges(smooth, width, height)), 'higher smoothness reduces changes between lines')
assert(smooth.every((value) => value === 0 || value === 1), 'mask borders stay sharp')

const vertical = pixelSortV2Mask(maskOf(24, width), 24, width, 'vertical', 10, 20, 1, 10, 'random', 321)
for (let x = 0; x < 24; x++) {
  const column = Array.from({ length: width }, (_, y) => vertical[y * 24 + x])
  const start = column.findIndex((value) => value > 0)
  const end = column.findLastIndex((value) => value > 0)
  assert(start >= 0 && start <= 99, `vertical start ${start}`)
  assert(end >= 800 && end <= 999, `vertical end ${end}`)
}

console.log('Pixel sorting v2 supports independent boundaries, pixel-sized steps, and smoothness control')

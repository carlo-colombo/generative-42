import { areaWeight, hashString, mulberry32 } from './areas'
import type { Generation, SortArea } from './types'

const LUMINANCE_BUCKETS = 16384
// Long runs keep the dense prefix-sum pass; short runs only sort the buckets they
// touch. Both produce the same ascending bucket order with stable ties.
const DENSE_RUN_LENGTH = 1024

export type SortParams = SortArea['sort'] & { edge: SortArea['edge'] }

export type AreaRandom = (area: SortArea) => () => number

export function seededAreaRandom(seed: number): AreaRandom {
  return (area) => mulberry32(seed ^ hashString(area.id))
}

export function legacySortArea(generation: Generation): SortArea {
  return {
    id: 'color-sorting',
    label: 'Color sorting',
    color: '#ffffff',
    visible: true,
    shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1, rotation: 0 },
    edge: { feather: 0, jitter: 0, mode: 'blend' },
    sort: {
      direction: generation.colorSortDirection,
      reverse: false,
      amount: generation.colorSortAmount,
    },
    opacity: 100,
  }
}

export function soloAreas(areas: SortArea[], soloAreaId: string): SortArea[] {
  if (!soloAreaId) return areas
  const solo = areas.filter((area) => area.id === soloAreaId)
  return solo.length > 0 ? solo : areas
}

function sortBucketKeys(keys: Uint16Array, length: number) {
  for (let gap = length >> 1; gap > 0; gap >>= 1) {
    for (let i = gap; i < length; i++) {
      const key = keys[i]
      let j = i
      while (j >= gap && keys[j - gap] > key) {
        keys[j] = keys[j - gap]
        j -= gap
      }
      keys[j] = key
    }
  }
}

// A null weight means the mask covers the whole canvas (all ones).
function sortPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  weight: Float32Array | null,
  params: SortParams,
  random: () => number,
): Uint8ClampedArray {
  const target = new Uint8ClampedArray(source)
  const horizontal = params.direction === 'horizontal'
  const lineLength = horizontal ? width : height
  const lineCount = horizontal ? height : width
  const step = horizontal ? 1 : width
  const amount = Math.max(0, Math.min(100, params.amount))
  const blend = params.edge.mode === 'blend'
  const jitter = params.edge.mode === 'ragged' ? (Math.max(0, params.edge.jitter) / 100) * Math.min(width, height) : 0
  const bucketScale = LUMINANCE_BUCKETS / 255

  const counts = new Int32Array(LUMINANCE_BUCKETS)
  const buckets = new Uint16Array(lineLength)
  const positions = new Uint32Array(lineLength)
  const usedBuckets = new Uint16Array(lineLength)
  let countsDirty = false

  function sortRun(lineStart: number, start: number, end: number, lineAmount: number) {
    const runLength = end - start
    const sortedLength = Math.round((runLength * lineAmount) / 100)
    if (sortedLength < 2) return

    let from = params.reverse ? end - sortedLength : start
    if (jitter > 0) {
      const shift = Math.round((random() * 2 - 1) * jitter)
      from = Math.min(end - sortedLength, Math.max(start, from + shift))
    }

    if (sortedLength >= DENSE_RUN_LENGTH) {
      counts.fill(0)
      for (let i = 0; i < sortedLength; i++) {
        const index = (lineStart + (from + i) * step) * 4
        const luminance = 0.299 * source[index] + 0.587 * source[index + 1] + 0.114 * source[index + 2]
        let bucket = (luminance * bucketScale) | 0
        if (bucket >= LUMINANCE_BUCKETS) bucket = LUMINANCE_BUCKETS - 1
        buckets[i] = bucket
        counts[bucket]++
      }

      let offset = 0
      for (let bucket = 0; bucket < LUMINANCE_BUCKETS; bucket++) {
        const count = counts[bucket]
        counts[bucket] = offset
        offset += count
      }

      for (let i = 0; i < sortedLength; i++) {
        positions[counts[buckets[i]]++] = i
      }
      countsDirty = true
    } else {
      if (countsDirty) {
        counts.fill(0)
        countsDirty = false
      }

      let usedCount = 0
      for (let i = 0; i < sortedLength; i++) {
        const index = (lineStart + (from + i) * step) * 4
        const luminance = 0.299 * source[index] + 0.587 * source[index + 1] + 0.114 * source[index + 2]
        let bucket = (luminance * bucketScale) | 0
        if (bucket >= LUMINANCE_BUCKETS) bucket = LUMINANCE_BUCKETS - 1
        buckets[i] = bucket
        if (counts[bucket] === 0) usedBuckets[usedCount++] = bucket
        counts[bucket]++
      }

      sortBucketKeys(usedBuckets, usedCount)

      let offset = 0
      for (let k = 0; k < usedCount; k++) {
        const bucket = usedBuckets[k]
        const count = counts[bucket]
        counts[bucket] = offset
        offset += count
      }

      for (let i = 0; i < sortedLength; i++) {
        positions[counts[buckets[i]]++] = i
      }

      for (let k = 0; k < usedCount; k++) counts[usedBuckets[k]] = 0
    }

    for (let i = 0; i < sortedLength; i++) {
      const sourceIndex = (lineStart + (from + positions[i]) * step) * 4
      const targetIndex = (lineStart + (from + i) * step) * 4
      if (blend) {
        const coverage = weight ? weight[lineStart + (from + i) * step] : 1
        target[targetIndex] = source[sourceIndex] * coverage + source[targetIndex] * (1 - coverage)
        target[targetIndex + 1] = source[sourceIndex + 1] * coverage + source[targetIndex + 1] * (1 - coverage)
        target[targetIndex + 2] = source[sourceIndex + 2] * coverage + source[targetIndex + 2] * (1 - coverage)
        target[targetIndex + 3] = source[sourceIndex + 3] * coverage + source[targetIndex + 3] * (1 - coverage)
      } else {
        target[targetIndex] = source[sourceIndex]
        target[targetIndex + 1] = source[sourceIndex + 1]
        target[targetIndex + 2] = source[sourceIndex + 2]
        target[targetIndex + 3] = source[sourceIndex + 3]
      }
    }
  }

  for (let line = 0; line < lineCount; line++) {
    // (1.15 - 0.85) is spelled out to keep the legacy p5.random(0.85, 1.15) float sequence identical
    const lineAmount = Math.max(0, Math.min(100, amount * (random() * (1.15 - 0.85) + 0.85)))
    const lineStart = horizontal ? line * width : line
    if (weight === null) {
      sortRun(lineStart, 0, lineLength, lineAmount)
      continue
    }
    let position = 0
    while (position < lineLength) {
      if (weight[lineStart + position * step] <= 0) {
        position++
        continue
      }
      let end = position + 1
      while (end < lineLength && weight[lineStart + end * step] > 0) end++
      sortRun(lineStart, position, end, lineAmount)
      position = end
    }
  }

  return target
}

function unionWeight(areas: SortArea[], width: number, height: number, seed: number): Float32Array {
  const union = new Float32Array(width * height)
  for (const area of areas) {
    const weight = areaWeight(area, width, height, seed)
    for (let i = 0; i < union.length; i++) {
      if (weight[i] > 0) union[i] = weight[i]
    }
  }
  return union
}

function composite(
  result: Uint8ClampedArray,
  pass: Uint8ClampedArray,
  weight: Float32Array,
  opacity: number,
  mode: SortArea['edge']['mode'],
) {
  const opacityAlpha = Math.max(0, Math.min(100, opacity)) / 100
  if (opacityAlpha <= 0) return
  const soft = mode === 'blend'
  for (let pixel = 0, index = 0; pixel < weight.length; pixel++, index += 4) {
    const coverage = weight[pixel]
    if (coverage <= 0) continue
    // Blend keeps the feather ramp; ragged edges stay crisp at full coverage.
    const alpha = soft ? opacityAlpha * Math.min(1, coverage) : opacityAlpha
    if (alpha >= 1) {
      result[index] = pass[index]
      result[index + 1] = pass[index + 1]
      result[index + 2] = pass[index + 2]
      result[index + 3] = pass[index + 3]
    } else {
      result[index] = result[index] + (pass[index] - result[index]) * alpha
      result[index + 1] = result[index + 1] + (pass[index + 1] - result[index + 1]) * alpha
      result[index + 2] = result[index + 2] + (pass[index + 2] - result[index + 2]) * alpha
      result[index + 3] = result[index + 3] + (pass[index + 3] - result[index + 3]) * alpha
    }
  }
}

function coversCanvas(area: SortArea): boolean {
  const shape = area.shape
  if (shape.kind !== 'rect' || shape.rotation !== 0 || shape.w <= 0 || shape.h <= 0) return false
  return shape.x <= 0 && shape.y <= 0 && shape.x + shape.w >= 1 && shape.y + shape.h >= 1
}

function fullCoverage(area: SortArea): boolean {
  return coversCanvas(area) && area.edge.feather <= 0 && area.edge.jitter <= 0 && area.edge.mode === 'blend' && area.opacity >= 100
}

export function sortAreas(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  areas: SortArea[],
  areasMode: Generation['areasMode'],
  seed: number,
  randomFor: AreaRandom,
): Uint8ClampedArray {
  const visible = areas.filter((area) => area.visible)
  if (visible.length === 0) return new Uint8ClampedArray(source)

  if (visible.length === 1 && fullCoverage(visible[0])) {
    // A single full-canvas blend area needs no mask: every line is one run.
    const area = visible[0]
    return sortPixels(source, width, height, null, { ...area.sort, edge: area.edge }, randomFor(area))
  }

  const result = new Uint8ClampedArray(source)
  if (areasMode === 'union') {
    // Union resolves the mask per pixel and sorts it once with the topmost area's options.
    const top = visible[visible.length - 1]
    const weight = unionWeight(visible, width, height, seed)
    const pass = sortPixels(source, width, height, weight, { ...top.sort, edge: top.edge }, randomFor(top))
    composite(result, pass, weight, top.opacity, top.edge.mode)
    return result
  }

  for (const area of visible) {
    const weight = areaWeight(area, width, height, seed)
    const pass = sortPixels(source, width, height, weight, { ...area.sort, edge: area.edge }, randomFor(area))
    composite(result, pass, weight, area.opacity, area.edge.mode)
  }
  return result
}

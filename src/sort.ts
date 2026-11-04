import { MAX_SPAN_WIDTH } from './types'
import type { ColorSortDirection } from './types'

const LUMINANCE_BUCKETS = 16384
// Long sort blocks keep the dense prefix-sum pass; short blocks only sort the
// buckets they touch. Both produce the same ascending bucket order with stable
// ties.
const DENSE_RUN_LENGTH = 1024

export type SortOptions = {
  direction: ColorSortDirection
  reverse: boolean
  randomness: number
  // Consecutive pixels along the sort axis averaged into one sortable span.
  spanWidth: number
  // Up to this share of the shorter canvas side, in either direction, per run.
  jitter: number
  // Migrated legacy color-sorting layers sort a fixed share of every run; live
  // pixel-sort layers pass null and always sort whole runs.
  amount: number | null
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

// Writes the raw sorted pixels; the composition engine applies feather, ragged
// coverage and opacity once, so nothing is blended here.
// A null weight means the mask covers the whole canvas (all ones).
export function sortPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  weight: Float32Array | null,
  options: SortOptions,
  random: () => number,
): Uint8ClampedArray {
  const target = new Uint8ClampedArray(source)
  const horizontal = options.direction === 'horizontal'
  const lineLength = horizontal ? width : height
  const lineCount = horizontal ? height : width
  const step = horizontal ? 1 : width
  const amount = options.amount === null ? null : Math.max(0, Math.min(100, options.amount))
  const randomness = Math.max(0, Math.min(100, options.randomness)) / 100
  const spanWidth = Math.max(1, Math.min(MAX_SPAN_WIDTH, Math.round(options.spanWidth)))
  const jitter = (Math.max(0, options.jitter) / 100) * Math.min(width, height)
  const bucketScale = LUMINANCE_BUCKETS / 255

  const counts = new Int32Array(LUMINANCE_BUCKETS)
  const buckets = new Uint16Array(lineLength)
  const positions = new Uint32Array(lineLength)
  const usedBuckets = new Uint16Array(lineLength)
  let countsDirty = false

  function spanLuminance(lineStart: number, start: number, count: number): number {
    if (count === 1) {
      const index = (lineStart + start * step) * 4
      return 0.299 * source[index] + 0.587 * source[index + 1] + 0.114 * source[index + 2]
    }
    let index = (lineStart + start * step) * 4
    let red = 0
    let green = 0
    let blue = 0
    for (let pixel = 0; pixel < count; pixel++) {
      red += source[index]
      green += source[index + 1]
      blue += source[index + 2]
      index += step * 4
    }
    return (0.299 * red + 0.587 * green + 0.114 * blue) / count
  }

  function sortRun(lineStart: number, start: number, end: number, lineAmount: number) {
    const runLength = end - start
    if (runLength < 2) return
    const span = amount === null ? runLength : Math.min(runLength, Math.round((runLength * lineAmount) / 100))
    // The block is trimmed from the end a run is read from, so 0 sorts the whole run.
    const skip = randomness > 0 ? Math.round(random() * span * randomness) : 0
    const sortedLength = span - skip
    if (sortedLength < 2) return

    let from = options.reverse ? end - span : start + skip
    if (jitter > 0) {
      const shift = Math.round((random() * 2 - 1) * jitter)
      from = Math.min(lineLength - sortedLength, Math.max(0, from + shift))
    }

    // Spans start at the edge the block is read from, so reverse mirrors the
    // grouping; the trailing span keeps whichever width is left in the block.
    const spanCount = Math.ceil(sortedLength / spanWidth)

    if (spanCount >= DENSE_RUN_LENGTH) {
      counts.fill(0)
      for (let i = 0, k = 0; i < sortedLength; i += spanWidth, k++) {
        const luminance = spanLuminance(lineStart, from + i, Math.min(spanWidth, sortedLength - i))
        let bucket = (luminance * bucketScale) | 0
        if (bucket >= LUMINANCE_BUCKETS) bucket = LUMINANCE_BUCKETS - 1
        buckets[k] = bucket
        counts[bucket]++
      }

      let offset = 0
      for (let bucket = 0; bucket < LUMINANCE_BUCKETS; bucket++) {
        const count = counts[bucket]
        counts[bucket] = offset
        offset += count
      }

      for (let k = 0; k < spanCount; k++) {
        positions[counts[buckets[k]]++] = k
      }
      countsDirty = true
    } else {
      if (countsDirty) {
        counts.fill(0)
        countsDirty = false
      }

      let usedCount = 0
      for (let i = 0, k = 0; i < sortedLength; i += spanWidth, k++) {
        const luminance = spanLuminance(lineStart, from + i, Math.min(spanWidth, sortedLength - i))
        let bucket = (luminance * bucketScale) | 0
        if (bucket >= LUMINANCE_BUCKETS) bucket = LUMINANCE_BUCKETS - 1
        buckets[k] = bucket
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

      for (let k = 0; k < spanCount; k++) {
        positions[counts[buckets[k]]++] = k
      }

      for (let k = 0; k < usedCount; k++) counts[usedBuckets[k]] = 0
    }

    // Whole spans move, and each destination span is flooded with the average
    // colour of the span it received.
    if (spanWidth === 1) {
      for (let i = 0; i < sortedLength; i++) {
        const sourceIndex = (lineStart + (from + positions[i]) * step) * 4
        const targetIndex = (lineStart + (from + i) * step) * 4
        target[targetIndex] = source[sourceIndex]
        target[targetIndex + 1] = source[sourceIndex + 1]
        target[targetIndex + 2] = source[sourceIndex + 2]
        target[targetIndex + 3] = source[sourceIndex + 3]
      }
      return
    }

    for (let i = 0, k = 0; i < sortedLength; i += spanWidth, k++) {
      const sourceSpan = positions[k] * spanWidth
      const sourceCount = Math.min(spanWidth, sortedLength - sourceSpan)
      let sourceIndex = (lineStart + (from + sourceSpan) * step) * 4
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      for (let pixel = 0; pixel < sourceCount; pixel++) {
        red += source[sourceIndex]
        green += source[sourceIndex + 1]
        blue += source[sourceIndex + 2]
        alpha += source[sourceIndex + 3]
        sourceIndex += step * 4
      }
      const redValue = Math.round(red / sourceCount)
      const greenValue = Math.round(green / sourceCount)
      const blueValue = Math.round(blue / sourceCount)
      const alphaValue = Math.round(alpha / sourceCount)
      const targetCount = Math.min(spanWidth, sortedLength - i)
      let targetIndex = (lineStart + (from + i) * step) * 4
      for (let pixel = 0; pixel < targetCount; pixel++) {
        target[targetIndex] = redValue
        target[targetIndex + 1] = greenValue
        target[targetIndex + 2] = blueValue
        target[targetIndex + 3] = alphaValue
        targetIndex += step * 4
      }
    }
  }

  for (let line = 0; line < lineCount; line++) {
    // (1.15 - 0.85) keeps the legacy p5.random(0.85, 1.15) float sequence recognizable
    const lineAmount = amount === null ? 100 : Math.max(0, Math.min(100, amount * (random() * (1.15 - 0.85) + 0.85)))
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

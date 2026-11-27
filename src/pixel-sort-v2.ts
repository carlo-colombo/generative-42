import { mulberry32 } from './areas'
import type { ColorSortDirection } from './types'

export type BorderNoise = 'random' | '1d'

export function pixelSortV2Mask(
  mask: Float32Array,
  width: number,
  height: number,
  direction: ColorSortDirection,
  leftRandomness: number,
  rightRandomness: number,
  pixelSize: number,
  noiseSmoothness: number,
  noise: BorderNoise,
  seed: number,
): Float32Array {
  const horizontal = direction === 'horizontal'
  const lineLength = horizontal ? width : height
  const lineCount = horizontal ? height : width
  const step = horizontal ? 1 : width
  const noiseStep = Math.max(1, Math.ceil(lineCount * noiseSmoothness / 100))
  const noiseValues = new Map<string, number[]>()
  const randomValues = new Map<string, () => number>()
  const sampleNoise = (line: number, run: number, side: number): number => {
    const key = `${run}:${side}`
    if (noise === 'random') {
      let random = randomValues.get(key)
      if (!random) {
        random = mulberry32(seed ^ Math.imul(run + 1, 0x85ebca6b) ^ side)
        randomValues.set(key, random)
      }
      return random()
    }
    let values = noiseValues.get(key)
    if (!values) {
      const random = mulberry32(seed ^ Math.imul(run + 1, 0x85ebca6b) ^ side)
      values = Array.from({ length: Math.ceil(lineCount / noiseStep) + 1 }, random)
      noiseValues.set(key, values)
    }
    const position = line / noiseStep
    const index = Math.floor(position)
    const t = position - index
    const smooth = t * t * (3 - 2 * t)
    return values[index] + (values[index + 1] - values[index]) * smooth
  }

  for (let line = 0; line < lineCount; line++) {
    const base = horizontal ? line * width : line
    const runs: [number, number][] = []
    let position = 0
    while (position < lineLength) {
      if (mask[base + position * step] <= 0) {
        position++
        continue
      }
      const start = position
      while (position < lineLength && mask[base + position * step] > 0) position++
      runs.push([start, position])
    }
    for (let offset = 0; offset < lineLength; offset++) mask[base + offset * step] = 0
    for (const [run, [start, end]] of runs.entries()) {
      const units = Math.ceil((end - start) / pixelSize)
      const leftWindow = Math.floor(units * leftRandomness / 100)
      const rightWindow = Math.floor(units * rightRandomness / 100)
      const leftShift = leftWindow > 0 ? Math.floor(sampleNoise(line, run, 0) * leftWindow) : 0
      const rightShift = rightWindow > 0 ? Math.floor(sampleNoise(line, run, 1) * rightWindow) : 0
      const selectedStart = start + leftShift * pixelSize
      const selectedEnd = Math.min(end, start + (units - rightShift) * pixelSize)
      for (let offset = selectedStart; offset < selectedEnd; offset++) mask[base + offset * step] = 1
    }
  }
  return mask
}

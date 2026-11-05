import { mulberry32 } from './areas'
import type { Pt } from './types'

export type PoissonResult = { points: Pt[]; minDistance: number }

// A maximal Poisson-disc set holds roughly this many points per square radius.
const PACKING_DENSITY = 0.7
const SAMPLE_ATTEMPTS = 30
const RADIUS_ATTEMPTS = 5

function bridson(width: number, height: number, count: number, radius: number, rand: () => number): Pt[] {
  const cellSize = radius / Math.SQRT2
  const cols = Math.max(1, Math.ceil(width / cellSize))
  const rows = Math.max(1, Math.ceil(height / cellSize))
  const grid = new Int32Array(cols * rows).fill(-1)
  const points: Pt[] = []
  const active: number[] = []
  const radiusSq = radius * radius

  const insert = (x: number, y: number) => {
    const index = points.length
    points.push({ x, y })
    const gx = Math.min(cols - 1, Math.floor(x / cellSize))
    const gy = Math.min(rows - 1, Math.floor(y / cellSize))
    grid[gy * cols + gx] = index
    active.push(index)
  }

  const tooClose = (x: number, y: number) => {
    const gx = Math.floor(x / cellSize)
    const gy = Math.floor(y / cellSize)
    const x0 = Math.max(0, gx - 2)
    const x1 = Math.min(cols - 1, gx + 2)
    const y0 = Math.max(0, gy - 2)
    const y1 = Math.min(rows - 1, gy + 2)
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const index = grid[cy * cols + cx]
        if (index < 0) continue
        const dx = points[index].x - x
        const dy = points[index].y - y
        if (dx * dx + dy * dy < radiusSq) return true
      }
    }
    return false
  }

  insert(rand() * width, rand() * height)

  while (active.length > 0 && points.length < count) {
    const slot = Math.floor(rand() * active.length)
    const origin = points[active[slot]]
    let placed = false
    for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt++) {
      const angle = rand() * Math.PI * 2
      const distance = radius * (1 + rand())
      const x = origin.x + Math.cos(angle) * distance
      const y = origin.y + Math.sin(angle) * distance
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      if (tooClose(x, y)) continue
      insert(x, y)
      placed = true
      break
    }
    if (!placed) {
      active[slot] = active[active.length - 1]
      active.pop()
    }
  }

  return points
}

// Bridson's sampler packs points at a minimum distance; aiming at `target` points
// needs a radius guessed from the packing density and then corrected by sampling,
// because the actual count for a radius varies. Each attempt reseeds so the result
// stays deterministic, and the closest count wins.
export function poissonSites(width: number, height: number, target: number, seed: number): PoissonResult {
  const area = width * height
  if (width <= 0 || height <= 0 || area <= 0) return { points: [], minDistance: 1 }
  const count = Math.max(1, Math.min(Math.round(target), Math.floor(area / 4)))
  let radius = Math.max(Math.sqrt((PACKING_DENSITY * area) / count), 1)
  let best: PoissonResult | null = null

  for (let attempt = 0; attempt < RADIUS_ATTEMPTS; attempt++) {
    const points = bridson(width, height, count, radius, mulberry32((seed ^ Math.imul(attempt + 1, 0x9e3779b9)) >>> 0))
    if (points.length === count) return { points, minDistance: radius }
    if (!best || Math.abs(points.length - count) < Math.abs(best.points.length - count)) {
      best = { points, minDistance: radius }
    }
    if (points.length === 0) break
    radius *= Math.sqrt(points.length / count)
  }

  return best ?? { points: [], minDistance: radius }
}

// Replaces every pixel with the average colour of its Voronoi cell. The site grid
// holds at most one point per cell (the cells are radius / sqrt(2) wide), so each
// pixel only has to scan outward a few rings before the nearest site is certain.
export function voronoiCellPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  points: Pt[],
  minDistance: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  if (points.length === 0 || width <= 0 || height <= 0) return out

  const count = points.length
  const sx = new Float32Array(count)
  const sy = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    sx[i] = points[i].x
    sy[i] = points[i].y
  }

  const cellSize = Math.max(minDistance / Math.SQRT2, 1e-3)
  const cols = Math.max(1, Math.ceil(width / cellSize))
  const rows = Math.max(1, Math.ceil(height / cellSize))
  const grid = new Int32Array(cols * rows).fill(-1)
  for (let i = 0; i < count; i++) {
    const gx = Math.min(cols - 1, Math.max(0, Math.floor(sx[i] / cellSize)))
    const gy = Math.min(rows - 1, Math.max(0, Math.floor(sy[i] / cellSize)))
    const slot = gy * cols + gx
    if (grid[slot] < 0) grid[slot] = i
  }

  const owner = new Int32Array(width * height)
  const sums = new Float64Array(count * 3)
  const totals = new Uint32Array(count)
  const maxRing = Math.max(cols, rows)

  for (let y = 0; y < height; y++) {
    const gy = Math.min(rows - 1, Math.floor(y / cellSize))
    for (let x = 0; x < width; x++) {
      const gx = Math.min(cols - 1, Math.floor(x / cellSize))
      let bestSq = Infinity
      let best = -1
      for (let ring = 0; ring <= maxRing; ring++) {
        const x0 = gx - ring
        const x1 = gx + ring
        const y0 = gy - ring
        const y1 = gy + ring
        for (let cy = y0; cy <= y1; cy++) {
          if (cy < 0 || cy >= rows) continue
          for (let cx = x0; cx <= x1; cx++) {
            if (cx < 0 || cx >= cols) continue
            const site = grid[cy * cols + cx]
            if (site < 0) continue
            const dx = sx[site] - x
            const dy = sy[site] - y
            const distance = dx * dx + dy * dy
            if (distance < bestSq) {
              bestSq = distance
              best = site
            }
          }
        }
        if (best >= 0 && bestSq <= ring * ring * cellSize * cellSize) break
      }
      if (best < 0) best = 0
      const index = y * width + x
      owner[index] = best
      const pixel = index * 4
      sums[best * 3] += pixels[pixel]
      sums[best * 3 + 1] += pixels[pixel + 1]
      sums[best * 3 + 2] += pixels[pixel + 2]
      totals[best]++
    }
  }

  for (let index = 0; index < owner.length; index++) {
    const site = owner[index]
    const total = totals[site] || 1
    const pixel = index * 4
    out[pixel] = Math.round(sums[site * 3] / total)
    out[pixel + 1] = Math.round(sums[site * 3 + 1] / total)
    out[pixel + 2] = Math.round(sums[site * 3 + 2] / total)
    out[pixel + 3] = 255
  }

  return out
}

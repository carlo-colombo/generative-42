import type { AreaShape, LayerEdge, Pt } from './types'

export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rectRing(shape: Extract<AreaShape, { kind: 'rect' }>, width: number, height: number): Pt[] {
  const cx = (shape.x + shape.w / 2) * width
  const cy = (shape.y + shape.h / 2) * height
  const hw = (Math.abs(shape.w) * width) / 2
  const hh = (Math.abs(shape.h) * height) / 2
  const angle = (shape.rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const corner = (sx: number, sy: number): Pt => ({
    x: cx + sx * hw * cos - sy * hh * sin,
    y: cy + sx * hw * sin + sy * hh * cos,
  })
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
}

function ellipseRing(shape: Extract<AreaShape, { kind: 'ellipse' }>, width: number, height: number): Pt[] {
  const cx = shape.cx * width
  const cy = shape.cy * height
  const rx = Math.abs(shape.rx) * width
  const ry = Math.abs(shape.ry) * height
  const angle = (shape.rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
  const segments = Math.max(96, Math.min(512, Math.ceil(perimeter / 2)))
  const ring: Pt[] = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    const lx = Math.cos(t) * rx
    const ly = Math.sin(t) * ry
    ring.push({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos })
  }
  return ring
}

type Crossing = { segment: number; t: number; point: Pt; perimeter: number }

function perimeterPosition(point: Pt, width: number, height: number): number {
  const epsilon = 1e-6
  if (point.y <= epsilon) return point.x
  if (point.x >= width - epsilon) return width + point.y
  if (point.y >= height - epsilon) return width + height + (width - point.x)
  return 2 * width + height + (height - point.y)
}

function addCrossings(from: Pt, to: Pt, segment: number, width: number, height: number, out: Crossing[]) {
  const candidates: Pt[] = []
  const dx = to.x - from.x
  const dy = to.y - from.y

  if (dx !== 0) {
    for (const edgeX of [0, width]) {
      const t = (edgeX - from.x) / dx
      if (t < 0 || t > 1) continue
      const y = from.y + t * dy
      if (y < 0 || y > height) continue
      candidates.push({ x: edgeX, y })
    }
  }

  if (dy !== 0) {
    for (const edgeY of [0, height]) {
      const t = (edgeY - from.y) / dy
      if (t < 0 || t > 1) continue
      const x = from.x + t * dx
      if (x < 0 || x > width) continue
      candidates.push({ x, y: edgeY })
    }
  }

  for (const point of candidates) {
    const duplicate = out.some(
      (crossing) => crossing.segment === segment && Math.abs(crossing.point.x - point.x) < 1e-6 && Math.abs(crossing.point.y - point.y) < 1e-6,
    )
    if (duplicate) continue
    const t = Math.abs(dx) >= Math.abs(dy) ? (point.x - from.x) / (dx || 1) : (point.y - from.y) / (dy || 1)
    out.push({ segment, t, point, perimeter: perimeterPosition(point, width, height) })
  }
}

function boundarySteps(from: number, to: number, forward: boolean, width: number, height: number): Pt[] {
  const total = 2 * (width + height)
  const corners: (Pt & { pos: number })[] = [
    { x: 0, y: 0, pos: 0 },
    { x: width, y: 0, pos: width },
    { x: width, y: height, pos: width + height },
    { x: 0, y: height, pos: 2 * width + height },
  ]
  const span = (((forward ? to - from : from - to) % total) + total) % total
  const steps: { delta: number; point: Pt }[] = []

  for (const corner of corners) {
    const raw = forward ? corner.pos - from : from - corner.pos
    const delta = ((raw % total) + total) % total
    if (delta <= 0 || delta >= span) continue
    steps.push({ delta, point: { x: corner.x, y: corner.y } })
  }

  steps.sort((a, b) => a.delta - b.delta)
  return steps.map((step) => step.point)
}

function closeRing(extended: Pt[], entry: Crossing, exit: Crossing, side: 'a' | 'b', width: number, height: number): Pt[] {
  const ring: Pt[] = [entry.point]
  for (let i = entry.segment + 1; i <= exit.segment; i++) ring.push(extended[i])
  ring.push(exit.point)
  ring.push(...boundarySteps(exit.perimeter, entry.perimeter, side === 'b', width, height))
  return ring
}

function ringArea(ring: Pt[]): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

function openPathRing(points: Pt[], side: 'a' | 'b', width: number, height: number): Pt[] {
  const cleaned: Pt[] = []
  for (const point of points) {
    const last = cleaned[cleaned.length - 1]
    if (last && last.x === point.x && last.y === point.y) continue
    cleaned.push({ x: point.x, y: point.y })
  }
  if (cleaned.length < 2) return []

  const reach = 4 * (width + height)
  const head = cleaned[0]
  const headNext = cleaned[1]
  const tail = cleaned[cleaned.length - 1]
  const tailPrev = cleaned[cleaned.length - 2]

  const headLength = Math.hypot(head.x - headNext.x, head.y - headNext.y) || 1
  const tailLength = Math.hypot(tail.x - tailPrev.x, tail.y - tailPrev.y) || 1
  const extended: Pt[] = [
    { x: head.x + ((head.x - headNext.x) / headLength) * reach, y: head.y + ((head.y - headNext.y) / headLength) * reach },
    ...cleaned,
    { x: tail.x + ((tail.x - tailPrev.x) / tailLength) * reach, y: tail.y + ((tail.y - tailPrev.y) / tailLength) * reach },
  ]

  const crossings: Crossing[] = []
  for (let i = 0; i < extended.length - 1; i++) {
    addCrossings(extended[i], extended[i + 1], i, width, height, crossings)
  }
  crossings.sort((a, b) => (a.segment === b.segment ? a.t - b.t : a.segment - b.segment))
  if (crossings.length < 2) return []

  if (crossings.length === 2) return closeRing(extended, crossings[0], crossings[1], side, width, height)

  // A stroke that leaves and re-enters crosses the border more than twice; closing
  // over the first and last crossing loops the ring across the extra excursions.
  // Keep the pair whose ring encloses the widest region instead (see AGENTS.md).
  let best: Pt[] = []
  let bestArea = -1
  for (let i = 0; i < crossings.length - 1; i++) {
    for (let j = i + 1; j < crossings.length; j++) {
      const ring = closeRing(extended, crossings[i], crossings[j], side, width, height)
      const area = Math.abs(ringArea(ring))
      if (area > bestArea) {
        bestArea = area
        best = ring
      }
    }
  }
  return best
}

function pathRing(shape: Extract<AreaShape, { kind: 'path' }>, width: number, height: number): Pt[] {
  const points = shape.points.map((point) => ({ x: point.x * width, y: point.y * height }))
  if (shape.closed) return points
  return openPathRing(points, shape.side, width, height)
}

// Pixel-space ring of the mask region; open paths come back closed along the canvas boundary.
export function shapePolygon(shape: AreaShape, width: number, height: number): Pt[] {
  if (shape.kind === 'rect') return rectRing(shape, width, height)
  if (shape.kind === 'ellipse') return ellipseRing(shape, width, height)
  return pathRing(shape, width, height)
}

function hashCell(x: number, y: number, seed: number): number {
  let hash = seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d)
  hash = Math.imul(hash ^ (hash >>> 13), 0x297a2d39)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
}

function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell
  const gy = y / cell
  const ix = Math.floor(gx)
  const iy = Math.floor(gy)
  let fx = gx - ix
  let fy = gy - iy
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)

  const n00 = hashCell(ix, iy, seed)
  const n10 = hashCell(ix + 1, iy, seed)
  const n01 = hashCell(ix, iy + 1, seed)
  const n11 = hashCell(ix + 1, iy + 1, seed)
  const nx0 = n00 + (n10 - n00) * fx
  const nx1 = n01 + (n11 - n01) * fx
  return nx0 + (nx1 - nx0) * fy
}

function raggedNoise(x: number, y: number, cell: number, seed: number): number {
  const coarse = valueNoise(x, y, cell, seed)
  const fine = valueNoise(x, y, Math.max(1, cell / 3), seed ^ 0x9e3779b9)
  return (coarse * 0.7 + fine * 0.3) * 2 - 1
}

// Mask scratch buffer reused per canvas size; callers that keep a weight map must
// copy it before the next call. Only the region the previous mask wrote is
// cleared, so reuse costs the shape, not the canvas.
type MaskRange = { startX: number; endX: number; startY: number; endY: number }
let maskScratch: (MaskRange & { width: number; height: number; weights: Float32Array }) | null = null

function maskBuffer(width: number, height: number): Float32Array {
  if (!maskScratch || maskScratch.width !== width || maskScratch.height !== height) {
    maskScratch = { width, height, weights: new Float32Array(width * height), startX: 0, endX: 0, startY: 0, endY: 0 }
    return maskScratch.weights
  }
  const { weights, startX, endX, startY, endY } = maskScratch
  for (let y = startY; y < endY; y++) weights.fill(0, y * width + startX, y * width + endX)
  maskScratch.startX = 0
  maskScratch.endX = 0
  maskScratch.startY = 0
  maskScratch.endY = 0
  return weights
}

function markMaskRange(startX: number, endX: number, startY: number, endY: number) {
  if (!maskScratch) return
  maskScratch.startX = startX
  maskScratch.endX = endX
  maskScratch.startY = startY
  maskScratch.endY = endY
}

function edgeValue(distance: number, feather: number, jitter: number, px: number, py: number, cell: number, noiseSeed: number): number {
  let d = distance
  if (jitter > 0) d += jitter * raggedNoise(px, py, cell, noiseSeed)
  if (d <= 0) return 0
  if (feather <= 0 || d >= feather) return 1
  const t = d / feather
  return t * t * (3 - 2 * t)
}

// Rect and ellipse coverage is closed form, so they skip the per-pixel edge loop
// that paths need. Positive distance means inside.
function analyticDistance(shape: AreaShape, width: number, height: number): ((px: number, py: number) => number) | null {
  if (shape.kind === 'path') return null

  const angle = (shape.rotation * Math.PI) / 180
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)

  if (shape.kind === 'rect') {
    const cx = (shape.x + shape.w / 2) * width
    const cy = (shape.y + shape.h / 2) * height
    const halfWidth = Math.max(0, (shape.w * width) / 2)
    const halfHeight = Math.max(0, (shape.h * height) / 2)
    return (px, py) => {
      const dx = px - cx
      const dy = py - cy
      const localX = Math.abs(dx * cos - dy * sin)
      const localY = Math.abs(dx * sin + dy * cos)
      const overX = localX - halfWidth
      const overY = localY - halfHeight
      if (overX <= 0 && overY <= 0) return Math.min(-overX, -overY)
      return -Math.hypot(Math.max(overX, 0), Math.max(overY, 0))
    }
  }

  const cx = shape.cx * width
  const cy = shape.cy * height
  const rx = Math.max(1e-6, shape.rx * width)
  const ry = Math.max(1e-6, shape.ry * height)
  return (px, py) => {
    const dx = px - cx
    const dy = py - cy
    const localX = dx * cos - dy * sin
    const localY = dx * sin + dy * cos
    const u = localX / rx
    const v = localY / ry
    const radius = Math.sqrt(u * u + v * v)
    if (radius < 1e-9) return Math.min(rx, ry)
    const length = Math.sqrt(localX * localX + localY * localY)
    return (length * (1 - radius)) / radius
  }
}

// Mask scratch buffer stays shared, so a caller that keeps a weight map must copy it.
export function maskWeight(
  shape: AreaShape,
  edge: LayerEdge,
  width: number,
  height: number,
  seed: number,
  id: string,
): Float32Array {
  const weights = maskBuffer(width, height)
  const ring = shapePolygon(shape, width, height)
  if (ring.length < 3) return weights

  const minSide = Math.min(width, height)
  const feather = (Math.max(0, edge.feather) / 100) * minSide
  const jitter = edge.mode === 'ragged' ? (Math.max(0, edge.jitter) / 100) * minSide : 0
  const cell = Math.max(2, Math.round(minSide / 128))
  const noiseSeed = (seed ^ hashString(id)) >>> 0
  const needsDistance = feather > 0 || jitter > 0

  const edgeCount = ring.length
  const ax = new Float64Array(edgeCount)
  const ay = new Float64Array(edgeCount)
  const bx = new Float64Array(edgeCount)
  const by = new Float64Array(edgeCount)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let i = 0; i < edgeCount; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % edgeCount]
    ax[i] = a.x
    ay[i] = a.y
    bx[i] = b.x
    by[i] = b.y
    minX = Math.min(minX, a.x)
    minY = Math.min(minY, a.y)
    maxX = Math.max(maxX, a.x)
    maxY = Math.max(maxY, a.y)
  }

  const margin = feather + jitter
  const startX = Math.max(0, Math.floor(minX - margin))
  const endX = Math.min(width, Math.ceil(maxX + margin))
  const startY = Math.max(0, Math.floor(minY - margin))
  const endY = Math.min(height, Math.ceil(maxY + margin))
  markMaskRange(startX, endX, startY, endY)
  const analytic = analyticDistance(shape, width, height)

  for (let y = startY; y < endY; y++) {
    const py = y + 0.5
    const rowStart = y * width
    for (let x = startX; x < endX; x++) {
      const px = x + 0.5

      if (analytic) {
        const distance = analytic(px, py)
        weights[rowStart + x] = needsDistance
          ? edgeValue(distance, feather, jitter, px, py, cell, noiseSeed)
          : distance > 0 ? 1 : 0
        continue
      }

      let inside = false
      let nearest = Infinity

      for (let e = 0; e < edgeCount; e++) {
        const x0 = ax[e]
        const y0 = ay[e]
        const x1 = bx[e]
        const y1 = by[e]
        if (y0 > py !== y1 > py && px < ((x1 - x0) * (py - y0)) / (y1 - y0) + x0) {
          inside = !inside
        }
        if (!needsDistance) continue

        const dx = x1 - x0
        const dy = y1 - y0
        const lengthSquared = dx * dx + dy * dy
        if (lengthSquared === 0) continue
        let t = ((px - x0) * dx + (py - y0) * dy) / lengthSquared
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const offsetX = px - (x0 + t * dx)
        const offsetY = py - (y0 + t * dy)
        const distanceSquared = offsetX * offsetX + offsetY * offsetY
        if (distanceSquared < nearest) nearest = distanceSquared
      }

      weights[rowStart + x] = needsDistance
        ? edgeValue(inside ? Math.sqrt(nearest) : -Math.sqrt(nearest), feather, jitter, px, py, cell, noiseSeed)
        : inside ? 1 : 0
    }
  }

  return weights
}

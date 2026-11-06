import type { AreaShape, LayerEdge, Pt } from './types'

export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function clampShape(shape: AreaShape): AreaShape {
  if (shape.kind === 'rect') {
    const x = clamp01(Math.min(shape.x, shape.x + shape.w))
    const y = clamp01(Math.min(shape.y, shape.y + shape.h))
    return {
      kind: 'rect',
      x,
      y,
      w: clamp01(Math.max(shape.x, shape.x + shape.w)) - x,
      h: clamp01(Math.max(shape.y, shape.y + shape.h)) - y,
      rotation: shape.rotation,
    }
  }
  if (shape.kind === 'ellipse') {
    return {
      kind: 'ellipse',
      cx: clamp01(shape.cx),
      cy: clamp01(shape.cy),
      rx: Math.min(0.5, Math.abs(shape.rx)),
      ry: Math.min(0.5, Math.abs(shape.ry)),
      rotation: shape.rotation,
    }
  }
  return {
    kind: 'path',
    closed: shape.closed,
    side: shape.side,
    tension: shape.tension,
    points: shape.points.map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) })),
  }
}

// The key the composition engine and the stage preview both use for a layer mask.
export function maskKey(shape: AreaShape, edge: LayerEdge, width: number, height: number, seed: number, id: string): string {
  return `${width}x${height}:${seed}:${id}:${JSON.stringify(shape)}:${edge.feather}:${edge.jitter}:${edge.mode}`
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

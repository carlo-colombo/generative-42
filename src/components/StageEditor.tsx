import { useEffect, useRef, useState } from 'preact/hooks'
import { maskKey, maskWeight, shapePolygon } from '../areas'
import type { EditorModel } from '../editor-state'
import { addLayer, clamp01, clampShape, createEffectLayer, translateShape, updateEffectLayer } from '../editor-state'
import { MAX_LAYERS, type GenerationModel } from '../generation-state'
import type { AreaShape, EffectLayer, Pt } from '../types'

type Px = { x: number; y: number }
type Size = { width: number; height: number }
type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type Handle = { id: HandleId; ux: number; uy: number }

const HANDLES: Handle[] = [
  { id: 'nw', ux: -1, uy: -1 },
  { id: 'n', ux: 0, uy: -1 },
  { id: 'ne', ux: 1, uy: -1 },
  { id: 'e', ux: 1, uy: 0 },
  { id: 'se', ux: 1, uy: 1 },
  { id: 's', ux: 0, uy: 1 },
  { id: 'sw', ux: -1, uy: 1 },
  { id: 'w', ux: -1, uy: 0 },
]

const HANDLE_HIT = 7
const VERTEX_HIT = 6
const EDGE_HIT = 8
const SIMPLIFY_TOLERANCE = 2
const MIN_DRAW_SIZE = 3
const MIN_SHAPE_SIZE = 4
// Per-layer preview masks are one byte per pixel; past this budget the preview
// rebuilds every mask instead of keeping them.
const MASK_PREVIEW_CACHE_BYTES = 64 * 1024 * 1024

type Drag =
  | { kind: 'none' }
  | { kind: 'shape'; tool: 'rect' | 'ellipse'; start: Px; current: Px; shift: boolean }
  | { kind: 'freehand'; tool: 'lasso' | 'curve'; points: Px[] }
  | { kind: 'move'; id: string; start: Px; shape: AreaShape }
  | { kind: 'resize'; id: string; handle: Handle; shape: AreaShape }
  | { kind: 'vertex'; id: string; index: number }

type RectFrame = { cx: number; cy: number; hw: number; hh: number; angle: number }
type EllipseFrame = { cx: number; cy: number; rx: number; ry: number; angle: number }

function uiScaleOf(canvas: HTMLCanvasElement): number {
  const bounds = canvas.getBoundingClientRect()
  return bounds.width > 0 ? canvas.width / bounds.width : 1
}

function toPx(point: Pt, size: Size): Px {
  return { x: point.x * size.width, y: point.y * size.height }
}

function toPt(point: Px, size: Size): Pt {
  return { x: clamp01(point.x / size.width), y: clamp01(point.y / size.height) }
}

function rotateVector(vector: Px, angle: number): Px {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: vector.x * cos - vector.y * sin, y: vector.x * sin + vector.y * cos }
}

function unrotateVector(vector: Px, angle: number): Px {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: vector.x * cos + vector.y * sin, y: -vector.x * sin + vector.y * cos }
}

function rectFrame(shape: Extract<AreaShape, { kind: 'rect' }>, size: Size): RectFrame {
  return {
    cx: (shape.x + shape.w / 2) * size.width,
    cy: (shape.y + shape.h / 2) * size.height,
    hw: (Math.abs(shape.w) * size.width) / 2,
    hh: (Math.abs(shape.h) * size.height) / 2,
    angle: (shape.rotation * Math.PI) / 180,
  }
}

function ellipseFrame(shape: Extract<AreaShape, { kind: 'ellipse' }>, size: Size): EllipseFrame {
  return {
    cx: shape.cx * size.width,
    cy: shape.cy * size.height,
    rx: Math.abs(shape.rx) * size.width,
    ry: Math.abs(shape.ry) * size.height,
    angle: (shape.rotation * Math.PI) / 180,
  }
}

function pathPoints(shape: Extract<AreaShape, { kind: 'path' }>, size: Size): Px[] {
  return shape.points.map((point) => toPx(point, size))
}

function boundsOfPoints(points: Px[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { minX, minY, maxX, maxY }
}

function outlinePoints(shape: AreaShape, size: Size): { points: Px[]; closed: boolean } {
  if (shape.kind === 'path') return { points: pathPoints(shape, size), closed: shape.closed }
  return { points: shapePolygon(shape, size.width, size.height), closed: true }
}

// The mask region, i.e. what maskWeight covers; open paths come back closed along the canvas border.
function regionPoints(shape: AreaShape, size: Size): Px[] {
  return shapePolygon(shape, size.width, size.height)
}

function shapeBounds(shape: AreaShape, size: Size): Bounds {
  return boundsOfPoints(outlinePoints(shape, size).points)
}

function handlePoints(shape: AreaShape, size: Size): (Handle & { point: Px })[] {
  if (shape.kind === 'rect' || shape.kind === 'ellipse') {
    const frame = shape.kind === 'rect' ? rectFrame(shape, size) : ellipseFrame(shape, size)
    const halfW = 'hw' in frame ? frame.hw : frame.rx
    const halfH = 'hh' in frame ? frame.hh : frame.ry
    return HANDLES.map((handle) => {
      const offset = rotateVector({ x: handle.ux * halfW, y: handle.uy * halfH }, frame.angle)
      return { ...handle, point: { x: frame.cx + offset.x, y: frame.cy + offset.y } }
    })
  }

  const bounds = shapeBounds(shape, size)
  const midX = (bounds.minX + bounds.maxX) / 2
  const midY = (bounds.minY + bounds.maxY) / 2
  return HANDLES.map((handle) => ({
    ...handle,
    point: {
      x: handle.ux === -1 ? bounds.minX : handle.ux === 1 ? bounds.maxX : midX,
      y: handle.uy === -1 ? bounds.minY : handle.uy === 1 ? bounds.maxY : midY,
    },
  }))
}

function resizeCursor(shape: AreaShape, handle: Handle, size: Size): string {
  const angle = shape.kind === 'rect' ? rectFrame(shape, size).angle : shape.kind === 'ellipse' ? ellipseFrame(shape, size).angle : 0
  const direction = rotateVector({ x: handle.ux, y: handle.uy }, angle)
  let heading = Math.atan2(direction.y, direction.x) % Math.PI
  if (heading < 0) heading += Math.PI
  const slice = Math.PI / 8
  if (heading < slice || heading >= 7 * slice) return 'ew-resize'
  if (heading < 3 * slice) return 'nwse-resize'
  if (heading < 5 * slice) return 'ns-resize'
  return 'nesw-resize'
}

function distanceToSegment(point: Px, a: Px, b: Px): { distance: number; point: Px } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return { distance: Math.hypot(point.x - a.x, point.y - a.y), point: a }
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const projected = { x: a.x + t * dx, y: a.y + t * dy }
  return { distance: Math.hypot(point.x - projected.x, point.y - projected.y), point: projected }
}

function nearestSegment(points: Px[], closed: boolean, point: Px) {
  let best: { index: number; distance: number; point: Px } | null = null
  const segments = closed ? points.length : points.length - 1
  for (let i = 0; i < segments; i++) {
    const result = distanceToSegment(point, points[i], points[(i + 1) % points.length])
    if (!best || result.distance < best.distance) best = { index: i, distance: result.distance, point: result.point }
  }
  return best
}

function pointInPolygon(point: Px, polygon: Px[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

function hitShape(shape: AreaShape, point: Px, size: Size, tolerance: number): boolean {
  if (shape.kind === 'rect' || shape.kind === 'ellipse') {
    const frame = shape.kind === 'rect' ? rectFrame(shape, size) : ellipseFrame(shape, size)
    const local = unrotateVector({ x: point.x - frame.cx, y: point.y - frame.cy }, frame.angle)
    if (shape.kind === 'rect') {
      const box = frame as RectFrame
      return Math.abs(local.x) <= box.hw + tolerance && Math.abs(local.y) <= box.hh + tolerance
    }
    const ellipse = frame as EllipseFrame
    return (local.x / (ellipse.rx + tolerance)) ** 2 + (local.y / (ellipse.ry + tolerance)) ** 2 <= 1
  }

  const points = pathPoints(shape, size)
  if (points.length === 0) return false
  if (shape.closed) {
    if (pointInPolygon(point, points)) return true
    const segment = nearestSegment(points, true, point)
    return Boolean(segment && segment.distance <= tolerance)
  }
  const segment = nearestSegment(points, false, point)
  return Boolean(segment && segment.distance <= tolerance * 1.5)
}

function simplify(points: Px[], tolerance: number): Px[] {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]

  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let farthest = -1
    let farthestDistance = 0
    for (let i = first + 1; i < last; i++) {
      const distance = distanceToSegment(points[i], points[first], points[last]).distance
      if (distance > farthestDistance) {
        farthestDistance = distance
        farthest = i
      }
    }
    if (farthest !== -1 && farthestDistance > tolerance) {
      keep[farthest] = 1
      stack.push([first, farthest], [farthest, last])
    }
  }

  return points.filter((_, index) => keep[index] === 1)
}

type MaskCache = Map<string, { version: string; mask: Uint8Array }>

function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return color
  const value = Number.parseInt(match[1], 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

export function StageEditor({ model, editor, baseCanvas }: { model: GenerationModel; editor: EditorModel; baseCanvas?: HTMLCanvasElement }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<() => void>(() => {})
  const dragRef = useRef<Drag>({ kind: 'none' })
  const polygonRef = useRef<Px[]>([])
  const hoverRef = useRef<Px | null>(null)
  const maskCacheRef = useRef<{ key: string; image: ImageData } | null>(null)
  const layerMaskCacheRef = useRef<MaskCache>(new Map())
  const frameRef = useRef(0)
  const selectedRef = useRef<EffectLayer | undefined>(undefined)
  const [polygonCount, setPolygonCount] = useState(0)
  const [pendingCurve, setPendingCurve] = useState<Px[] | null>(null)

  const draft = model.draft.value
  const tool = editor.tool.value
  const selectedId = editor.selectedLayerId.value
  const maskPreview = editor.maskPreview.value
  const showMasks = editor.showMasks.value
  const layers = draft.layers
    .filter((layer): layer is EffectLayer => layer.kind === 'effect')
    .map((layer) => ({ ...layer, shape: clampShape(layer.shape) }))
  const selected = layers.find((layer) => layer.id === selectedId)

  // One draw per animation frame: pointermoves and draft updates coalesce instead of
  // rebuilding the overlay for every event.
  function scheduleDraw() {
    if (frameRef.current !== 0) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      drawRef.current()
    })
  }

  function canvasSize(): Size | null {
    const canvas = canvasRef.current
    return canvas && canvas.width > 0 && canvas.height > 0 ? { width: canvas.width, height: canvas.height } : null
  }

  function drawLayer(context: CanvasRenderingContext2D, layer: EffectLayer, size: Size, isSelected: boolean, scale: number) {
    const soloedOut = Boolean(draft.soloLayerId) && draft.soloLayerId !== layer.id
    context.save()
    context.globalAlpha = layer.visible && !soloedOut ? 1 : 0.3

    if (isSelected) {
      const region = regionPoints(layer.shape, size)
      context.beginPath()
      region.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)))
      context.closePath()
      context.fillStyle = withAlpha(layer.color, 0.1)
      context.fill()
    }

    drawFeatherBand(context, layer, size)

    const outline = outlinePoints(layer.shape, size)
    context.beginPath()
    outline.points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)))
    if (outline.closed) context.closePath()
    context.setLineDash(isSelected ? [] : [7 * scale, 5 * scale])
    context.lineWidth = (isSelected ? 2 : 1.2) * scale
    context.strokeStyle = isSelected ? '#ffffff' : layer.color
    context.stroke()
    if (isSelected) {
      context.lineWidth = 1 * scale
      context.strokeStyle = layer.color
      context.stroke()
    }
    context.setLineDash([])

    if (layer.effect === 'pixel-sort') drawChevrons(context, layer, size, scale)
    drawLabel(context, layer, size, isSelected, scale)
    if (isSelected) drawHandles(context, layer.shape, size, scale)
    context.restore()
  }

  function drawFeatherBand(context: CanvasRenderingContext2D, layer: EffectLayer, size: Size) {
    const featherPx = (layer.edge.feather / 100) * Math.min(size.width, size.height)
    if (featherPx < 0.75) return
    context.save()
    const region = regionPoints(layer.shape, size)
    context.beginPath()
    region.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)))
    context.closePath()
    context.clip()

    context.beginPath()
    const outline = outlinePoints(layer.shape, size)
    outline.points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)))
    if (outline.closed) context.closePath()
    context.lineWidth = featherPx * 2
    context.strokeStyle = withAlpha(layer.color, 0.3)
    context.stroke()
    context.restore()
  }

  function drawChevrons(context: CanvasRenderingContext2D, layer: EffectLayer, size: Size, scale: number) {
    const bounds = shapeBounds(layer.shape, size)
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    if (width < 12 || height < 12) return

    const horizontal = layer.params.direction === 'horizontal'
    const forward = !layer.params.reverse
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    const spread = Math.min((horizontal ? width : height) * 0.32, 60 * scale)
    const arm = Math.min(Math.min(width, height) * 0.12, 11 * scale)

    context.save()
    context.strokeStyle = withAlpha(layer.color, 0.9)
    context.lineWidth = Math.max(1.5 * scale, arm * 0.22)
    context.lineCap = 'round'
    for (const step of [-1, -0.34, 0.34, 1]) {
      const offset = step * spread
      const center = {
        x: horizontal ? centerX + (forward ? offset : -offset) : centerX,
        y: horizontal ? centerY : centerY + (forward ? offset : -offset),
      }
      const direction = forward ? 1 : -1
      context.beginPath()
      if (horizontal) {
        context.moveTo(center.x - (arm / 2) * direction, center.y - arm / 2)
        context.lineTo(center.x + (arm / 2) * direction, center.y)
        context.lineTo(center.x - (arm / 2) * direction, center.y + arm / 2)
      } else {
        context.moveTo(center.x - arm / 2, center.y - (arm / 2) * direction)
        context.lineTo(center.x, center.y + (arm / 2) * direction)
        context.lineTo(center.x + arm / 2, center.y - (arm / 2) * direction)
      }
      context.stroke()
    }
    context.restore()
  }

  function drawLabel(context: CanvasRenderingContext2D, layer: EffectLayer, size: Size, isSelected: boolean, scale: number) {
    const bounds = shapeBounds(layer.shape, size)
    const fontSize = 11 * scale
    const text = layer.label || layer.id
    context.save()
    context.font = `${fontSize}px ui-monospace, "Space Mono", monospace`
    const metrics = context.measureText(text)
    const padding = 3 * scale
    const boxWidth = metrics.width + padding * 2
    const boxHeight = fontSize + padding * 2
    const x = Math.min(Math.max(bounds.minX + 4 * scale, 2), Math.max(2, size.width - boxWidth - 2))
    const y = Math.min(Math.max(bounds.minY + 4 * scale, 2), Math.max(2, size.height - boxHeight - 2))
    context.fillStyle = 'rgba(0, 0, 0, 0.6)'
    context.fillRect(x, y, boxWidth, boxHeight)
    context.fillStyle = isSelected ? '#ffffff' : layer.color
    context.textBaseline = 'middle'
    context.fillText(text, x + padding, y + boxHeight / 2 + 0.5)
    context.restore()
  }

  function drawHandles(context: CanvasRenderingContext2D, shape: AreaShape, size: Size, scale: number) {
    const half = 3.5 * scale
    context.save()
    context.fillStyle = '#ffffff'
    context.strokeStyle = 'rgba(0, 0, 0, 0.75)'
    context.lineWidth = 1 * scale
    for (const handle of handlePoints(shape, size)) {
      context.beginPath()
      context.rect(handle.point.x - half, handle.point.y - half, half * 2, half * 2)
      context.fill()
      context.stroke()
    }
    if (shape.kind === 'path') {
      context.fillStyle = '#111111'
      context.strokeStyle = '#ffffff'
      context.lineWidth = 1.5 * scale
      for (const point of pathPoints(shape, size)) {
        context.beginPath()
        context.arc(point.x, point.y, half, 0, Math.PI * 2)
        context.fill()
        context.stroke()
      }
    }
    context.restore()
  }

  function drawPending(context: CanvasRenderingContext2D, size: Size, scale: number) {
    context.save()
    context.lineWidth = 1.5 * scale
    context.strokeStyle = '#ffffff'
    context.fillStyle = '#111111'
    context.setLineDash([5 * scale, 4 * scale])

    if (polygonRef.current.length > 0) {
      context.beginPath()
      polygonRef.current.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)))
      if (hoverRef.current) context.lineTo(hoverRef.current.x, hoverRef.current.y)
      context.stroke()
      context.setLineDash([])
      for (const point of polygonRef.current) {
        context.beginPath()
        context.arc(point.x, point.y, 3.5 * scale, 0, Math.PI * 2)
        context.fill()
        context.stroke()
      }
    }

    const drag = dragRef.current
    if (drag.kind === 'shape') {
      const shape = drag.tool === 'rect' ? rectFromDrag(drag, size) : ellipseFromDrag(drag, size)
      if (shape) {
        const outline = outlinePoints(shape, size)
        context.beginPath()
        outline.points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)))
        context.closePath()
        context.stroke()
      }
    }

    if (drag.kind === 'freehand' && drag.points.length > 1) {
      context.beginPath()
      drag.points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)))
      context.stroke()
    }

    if (pendingCurve) {
      context.beginPath()
      pendingCurve.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)))
      context.stroke()
    }
    context.restore()
  }

  function drawMaskPreview(context: CanvasRenderingContext2D, size: Size) {
    const renderable = layers.filter((layer) => layer.visible && (!draft.soloLayerId || draft.soloLayerId === layer.id))
    const pixelCount = size.width * size.height
    const versions = renderable.map((layer) => maskKey(layer.shape, layer.edge, size.width, size.height, draft.seed, layer.id))
    const key = `${size.width}x${size.height}:${draft.seed}:${versions.join('|')}`
    if (!maskCacheRef.current || maskCacheRef.current.key !== key) {
      const cache = layerMaskCacheRef.current
      const cacheable = renderable.length * pixelCount <= MASK_PREVIEW_CACHE_BYTES
      const combined = new Uint8Array(pixelCount)
      renderable.forEach((layer, index) => {
        const version = versions[index]
        const cached = cache.get(layer.id)
        let mask = cached && cached.version === version ? cached.mask : null
        if (!mask) {
          const weights = maskWeight(layer.shape, layer.edge, size.width, size.height, draft.seed, layer.id)
          mask = new Uint8Array(pixelCount)
          for (let i = 0; i < pixelCount; i++) mask[i] = Math.round(weights[i] * 255)
          if (cacheable) cache.set(layer.id, { version, mask })
        }
        for (let i = 0; i < pixelCount; i++) {
          if (mask[i] > combined[i]) combined[i] = mask[i]
        }
      })
      if (cacheable) {
        const live = new Set(renderable.map((layer) => layer.id))
        for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id)
      } else {
        cache.clear()
      }
      const image = new ImageData(size.width, size.height)
      for (let i = 0; i < pixelCount; i++) {
        const value = combined[i]
        const offset = i * 4
        image.data[offset] = value
        image.data[offset + 1] = value
        image.data[offset + 2] = value
        image.data[offset + 3] = 255
      }
      maskCacheRef.current = { key, image }
    }

    context.putImageData(maskCacheRef.current.image, 0, 0)
  }

  function draw() {
    const canvas = canvasRef.current
    if (!canvas || !baseCanvas) return
    if (baseCanvas.width > 0 && baseCanvas.height > 0) {
      if (canvas.width !== baseCanvas.width || canvas.height !== baseCanvas.height) {
        canvas.width = baseCanvas.width
        canvas.height = baseCanvas.height
      }
    }
    const size = canvasSize()
    const context = canvas.getContext('2d')
    if (!size || !context) return
    const scale = uiScaleOf(canvas)

    context.clearRect(0, 0, size.width, size.height)
    if (!showMasks) return
    if (maskPreview && dragRef.current.kind === 'none') {
      drawMaskPreview(context, size)
      return
    }
    // While a gesture is in flight the outlines follow it live and the weight map
    // is rebuilt once, when the pointer is released.
    for (const layer of layers) drawLayer(context, layer, size, layer.id === selectedId, scale)
    drawPending(context, size, scale)
  }

  useEffect(() => {
    setCursor(tool === 'select' ? 'default' : 'crosshair')
  }, [tool])

  useEffect(() => {
    selectedRef.current = selected
    drawRef.current = draw
    scheduleDraw()
  })

  useEffect(() => () => {
    if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
  }, [])

  useEffect(() => {
    if (!baseCanvas) return
    editor.canvasSize.value = { width: baseCanvas.width, height: baseCanvas.height }
    scheduleDraw()
  }, [baseCanvas, editor])

  function pointerToPx(event: PointerEvent): Px | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return null
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    }
  }

  function rectFromDrag(drag: Extract<Drag, { kind: 'shape' }>, size: Size): AreaShape | null {
    const canvas = canvasRef.current
    const minDraw = MIN_DRAW_SIZE * (canvas ? uiScaleOf(canvas) : 1)
    const left = Math.min(drag.start.x, drag.current.x)
    const top = Math.min(drag.start.y, drag.current.y)
    const width = Math.abs(drag.current.x - drag.start.x)
    const height = Math.abs(drag.current.y - drag.start.y)
    if (width < minDraw || height < minDraw) return null
    const start = toPt({ x: left, y: top }, size)
    const end = toPt({ x: left + width, y: top + height }, size)
    return { kind: 'rect', x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y, rotation: 0 }
  }

  function ellipseFromDrag(drag: Extract<Drag, { kind: 'shape' }>, size: Size): AreaShape | null {
    const canvas = canvasRef.current
    const minDraw = MIN_DRAW_SIZE * (canvas ? uiScaleOf(canvas) : 1)
    const width = Math.abs(drag.current.x - drag.start.x)
    const height = Math.abs(drag.current.y - drag.start.y)
    if (Math.max(width, height) < minDraw) return null
    const radiusX = (drag.shift ? Math.max(width, height) : width) / 2
    const radiusY = (drag.shift ? Math.max(width, height) : height) / 2
    const center = toPt({ x: (drag.start.x + drag.current.x) / 2, y: (drag.start.y + drag.current.y) / 2 }, size)
    return {
      kind: 'ellipse',
      cx: center.x,
      cy: center.y,
      rx: Math.min(0.5, radiusX / size.width),
      ry: Math.min(0.5, radiusY / size.height),
      rotation: 0,
    }
  }

  function commitShape(shape: AreaShape) {
    if (model.draft.value.layers.length >= MAX_LAYERS) return
    const layer = createEffectLayer(clampShape(shape), model.draft.value, editor.newEffect.value)
    if (!addLayer(model, layer)) return
    editor.selectedLayerId.value = layer.id
    editor.tool.value = 'select'
    polygonRef.current = []
    hoverRef.current = null
    setPolygonCount(0)
  }

  function closePolygon() {
    const canvas = canvasRef.current
    const size = canvasSize()
    const points = polygonRef.current
    polygonRef.current = []
    hoverRef.current = null
    setPolygonCount(0)
    if (!size) return
    const minGap = 2 * (canvas ? uiScaleOf(canvas) : 1)
    const deduped = points.filter(
      (point, index) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > minGap,
    )
    if (deduped.length < 3) {
      scheduleDraw()
      return
    }
    commitShape({ kind: 'path', closed: true, side: 'a', tension: 0, points: deduped.map((point) => toPt(point, size)) })
  }

  function commitCurve(side: 'a' | 'b') {
    const size = canvasSize()
    if (!size || !pendingCurve) return
    const points = pendingCurve
    setPendingCurve(null)
    if (points.length < 2) {
      scheduleDraw()
      return
    }
    commitShape({ kind: 'path', closed: false, side, tension: 0, points: points.map((point) => toPt(point, size)) })
  }

  function moveShape(start: AreaShape, from: Px, to: Px, size: Size): AreaShape {
    const bounds = shapeBounds(start, size)
    const dx = Math.max(-bounds.minX, Math.min(size.width - bounds.maxX, to.x - from.x))
    const dy = Math.max(-bounds.minY, Math.min(size.height - bounds.maxY, to.y - from.y))
    return translateShape(start, dx / size.width, dy / size.height)
  }

  function resizeShape(start: AreaShape, handle: Handle, point: Px, size: Size, minSize: number): AreaShape {
    if (start.kind === 'path') {
      const bounds = shapeBounds(start, size)
      const anchor = {
        x: handle.ux === 1 ? bounds.minX : handle.ux === -1 ? bounds.maxX : 0,
        y: handle.uy === 1 ? bounds.minY : handle.uy === -1 ? bounds.maxY : 0,
      }
      let scaleX = 1
      let scaleY = 1
      if (handle.ux !== 0) {
        const from = handle.ux === 1 ? bounds.maxX : bounds.minX
        const span = from - anchor.x
        scaleX = span === 0 ? 1 : (point.x - anchor.x) / span
      }
      if (handle.uy !== 0) {
        const from = handle.uy === 1 ? bounds.maxY : bounds.minY
        const span = from - anchor.y
        scaleY = span === 0 ? 1 : (point.y - anchor.y) / span
      }
      scaleX = Math.max(0.02, scaleX)
      scaleY = Math.max(0.02, scaleY)
      return {
        ...start,
        points: start.points.map((pathPoint) => {
          const px = toPx(pathPoint, size)
          return toPt({ x: anchor.x + (px.x - anchor.x) * scaleX, y: anchor.y + (px.y - anchor.y) * scaleY }, size)
        }),
      }
    }

    const frame = start.kind === 'rect' ? rectFrame(start, size) : ellipseFrame(start, size)
    const halfW = 'hw' in frame ? frame.hw : frame.rx
    const halfH = 'hh' in frame ? frame.hh : frame.ry
    const local = unrotateVector({ x: point.x - frame.cx, y: point.y - frame.cy }, frame.angle)
    const shift = { x: 0, y: 0 }
    let nextW = halfW
    let nextH = halfH

    if (handle.ux !== 0) {
      const anchor = -handle.ux * halfW
      const clamped = handle.ux === 1 ? Math.max(anchor + minSize / 2, local.x) : Math.min(anchor - minSize / 2, local.x)
      nextW = Math.max(minSize / 2, Math.abs(clamped - anchor) / 2)
      shift.x = (clamped + anchor) / 2
    }
    if (handle.uy !== 0) {
      const anchor = -handle.uy * halfH
      const clamped = handle.uy === 1 ? Math.max(anchor + minSize / 2, local.y) : Math.min(anchor - minSize / 2, local.y)
      nextH = Math.max(minSize / 2, Math.abs(clamped - anchor) / 2)
      shift.y = (clamped + anchor) / 2
    }

    const world = rotateVector(shift, frame.angle)
    const centerX = (frame.cx + world.x) / size.width
    const centerY = (frame.cy + world.y) / size.height
    const width = (nextW * 2) / size.width
    const height = (nextH * 2) / size.height

    if (start.kind === 'rect') {
      return { kind: 'rect', x: centerX - width / 2, y: centerY - height / 2, w: width, h: height, rotation: start.rotation }
    }
    return { kind: 'ellipse', cx: centerX, cy: centerY, rx: width / 2, ry: height / 2, rotation: start.rotation }
  }

  function startSelectDrag(point: Px, size: Size, alt: boolean, scale: number) {
    if (selected) {
      if (selected.shape.kind === 'path') {
        const points = pathPoints(selected.shape, size)
        for (let index = 0; index < points.length; index++) {
          if (Math.hypot(point.x - points[index].x, point.y - points[index].y) > VERTEX_HIT * scale) continue
          if (alt) {
            if (points.length > (selected.shape.closed ? 3 : 2)) {
              updateEffectLayer(model, selected.id, (layer) =>
                layer.shape.kind === 'path'
                  ? { ...layer, shape: { ...layer.shape, points: layer.shape.points.filter((_, i) => i !== index) } }
                  : layer,
              )
            }
            return
          }
          dragRef.current = { kind: 'vertex', id: selected.id, index }
          return
        }
        if (alt) {
          const segment = nearestSegment(points, selected.shape.closed, point)
          if (segment && segment.distance <= EDGE_HIT * scale && selected.shape.points.length > 1) {
            const inserted = toPt(segment.point, size)
            updateEffectLayer(model, selected.id, (layer) =>
              layer.shape.kind === 'path'
                ? {
                    ...layer,
                    shape: {
                      ...layer.shape,
                      points: [...layer.shape.points.slice(0, segment.index + 1), inserted, ...layer.shape.points.slice(segment.index + 1)],
                    },
                  }
                : layer,
            )
            return
          }
        }
      }

      const handle = handlePoints(selected.shape, size).find(
        (candidate) => Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y) <= HANDLE_HIT * scale,
      )
      if (handle) {
        dragRef.current = { kind: 'resize', id: selected.id, handle, shape: selected.shape }
        return
      }
    }

    const hit = [...layers].reverse().find((layer) => hitShape(layer.shape, point, size, EDGE_HIT * scale))
    if (!hit) {
      editor.selectedLayerId.value = null
      return
    }
    editor.selectedLayerId.value = hit.id
    dragRef.current = { kind: 'move', id: hit.id, start: point, shape: hit.shape }
  }

  function handlePointerDown(event: PointerEvent) {
    if (maskPreview || !baseCanvas) return
    const canvas = canvasRef.current
    const point = pointerToPx(event)
    const size = canvasSize()
    if (!canvas || !point || !size) return

    const scale = uiScaleOf(canvas)

    if (tool === 'select') {
      canvas.setPointerCapture(event.pointerId)
      startSelectDrag(point, size, event.altKey, scale)
      scheduleDraw()
      return
    }

    if (tool === 'polygon') {
      const last = polygonRef.current[polygonRef.current.length - 1]
      if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 2 * scale) {
        polygonRef.current = [...polygonRef.current, point]
        setPolygonCount(polygonRef.current.length)
      }
      scheduleDraw()
      return
    }

    canvas.setPointerCapture(event.pointerId)
    if (tool === 'rect' || tool === 'ellipse') {
      dragRef.current = { kind: 'shape', tool, start: point, current: point, shift: event.shiftKey }
    } else {
      dragRef.current = { kind: 'freehand', tool, points: [point] }
    }
    scheduleDraw()
  }

  function setCursor(value: string) {
    const canvas = canvasRef.current
    if (canvas) canvas.style.cursor = value
  }

  function hoverCursor(point: Px, size: Size, scale: number): string {
    if (maskPreview) return 'default'
    if (tool !== 'select') return 'crosshair'
    if (selected) {
      if (selected.shape.kind === 'path') {
        for (const vertex of pathPoints(selected.shape, size)) {
          if (Math.hypot(point.x - vertex.x, point.y - vertex.y) <= VERTEX_HIT * scale) return 'grab'
        }
      }
      const handle = handlePoints(selected.shape, size).find(
        (candidate) => Math.hypot(point.x - candidate.point.x, point.y - candidate.point.y) <= HANDLE_HIT * scale,
      )
      if (handle) return resizeCursor(selected.shape, handle, size)
    }
    const hit = [...layers].reverse().find((layer) => hitShape(layer.shape, point, size, EDGE_HIT * scale))
    return hit ? 'move' : 'default'
  }

  function handlePointerMove(event: PointerEvent) {
    const point = pointerToPx(event)
    const size = canvasSize()
    const canvas = canvasRef.current
    if (!point || !size || !canvas) return
    const drag = dragRef.current

    if (drag.kind === 'none') {
      setCursor(hoverCursor(point, size, uiScaleOf(canvas)))
      if (tool === 'polygon' && polygonRef.current.length > 0) {
        hoverRef.current = point
        scheduleDraw()
      }
      return
    }

    if (drag.kind === 'resize') setCursor(resizeCursor(drag.shape, drag.handle, size))
    else if (drag.kind === 'move' || drag.kind === 'vertex') setCursor('grabbing')
    else setCursor('crosshair')

    if (drag.kind === 'shape') {
      drag.current = point
      drag.shift = event.shiftKey
      scheduleDraw()
      return
    }

    if (drag.kind === 'freehand') {
      const last = drag.points[drag.points.length - 1]
      if (!last || Math.hypot(last.x - point.x, last.y - point.y) >= 1.5) {
        drag.points.push(point)
        scheduleDraw()
      }
      return
    }

    if (drag.kind === 'move') {
      const shape = moveShape(drag.shape, drag.start, point, size)
      updateEffectLayer(model, drag.id, (layer) => ({ ...layer, shape }))
      return
    }

    if (drag.kind === 'resize') {
      const minSize = MIN_SHAPE_SIZE * uiScaleOf(canvas)
      const shape = clampShape(resizeShape(drag.shape, drag.handle, point, size, minSize))
      updateEffectLayer(model, drag.id, (layer) => ({ ...layer, shape }))
      return
    }

    if (drag.kind === 'vertex') {
      updateEffectLayer(model, drag.id, (layer) =>
        layer.shape.kind === 'path'
          ? { ...layer, shape: { ...layer.shape, points: layer.shape.points.map((pathPoint, index) => (index === drag.index ? toPt(point, size) : pathPoint)) } }
          : layer,
      )
    }
  }

  function handlePointerUp(event: PointerEvent) {
    const canvas = canvasRef.current
    const point = pointerToPx(event)
    const size = canvasSize()
    const drag = dragRef.current
    dragRef.current = { kind: 'none' }
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    if (!size || !point) {
      scheduleDraw()
      return
    }

    if (drag.kind === 'shape') {
      drag.current = point
      drag.shift = event.shiftKey
      const shape = drag.tool === 'rect' ? rectFromDrag(drag, size) : ellipseFromDrag(drag, size)
      if (shape) commitShape(shape)
    } else if (drag.kind === 'freehand') {
      const simplified = simplify(drag.points, SIMPLIFY_TOLERANCE)
      if (drag.tool === 'lasso') {
        if (simplified.length >= 3) {
          commitShape({ kind: 'path', closed: true, side: 'a', tension: 0, points: simplified.map((point) => toPt(point, size)) })
        }
      } else if (simplified.length >= 2) {
        setPendingCurve(simplified)
      }
    }
    scheduleDraw()
  }

  function handlePointerCancel(event: PointerEvent) {
    const canvas = canvasRef.current
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    dragRef.current = { kind: 'none' }
    scheduleDraw()
  }

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return

      if (event.key === 'Escape') {
        polygonRef.current = []
        hoverRef.current = null
        setPolygonCount(0)
        setPendingCurve(null)
        dragRef.current = { kind: 'none' }
        editor.selectedLayerId.value = null
        scheduleDraw()
        return
      }

      // Keyboard editing follows the same gate as pointer editing on the stage.
      if (!editor.showMasks.value || editor.maskPreview.value) return

      if (event.key === 'Enter' && pendingCurve) {
        event.preventDefault()
        commitCurve('a')
        return
      }

      if (event.key === 'Enter' && polygonRef.current.length >= 3) {
        event.preventDefault()
        closePolygon()
        return
      }

      if (event.key === 'Backspace' && polygonRef.current.length > 0) {
        event.preventDefault()
        polygonRef.current = polygonRef.current.slice(0, -1)
        setPolygonCount(polygonRef.current.length)
        scheduleDraw()
        return
      }

      const active = selectedRef.current
      if (!active) return
      const step = event.shiftKey ? 0.01 : 0.001
      const delta = { x: 0, y: 0 }
      if (event.key === 'ArrowLeft') delta.x = -step
      else if (event.key === 'ArrowRight') delta.x = step
      else if (event.key === 'ArrowUp') delta.y = -step
      else if (event.key === 'ArrowDown') delta.y = step
      else return
      event.preventDefault()
      updateEffectLayer(model, active.id, (layer) => {
        const size = canvasSize()
        if (!size) return { ...layer, shape: clampShape(translateShape(layer.shape, delta.x, delta.y)) }
        return {
          ...layer,
          shape: moveShape(layer.shape, { x: 0, y: 0 }, { x: delta.x * size.width, y: delta.y * size.height }, size),
        }
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [model, editor, pendingCurve])

  return (
    <div className={showMasks ? 'stage-editor' : 'stage-editor is-hidden'}>
      <canvas
        ref={canvasRef}
        className="editor-canvas"
        role="img"
        aria-label="Layer editing surface: draw and adjust effect layers over the artwork"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => setCursor(tool === 'select' ? 'default' : 'crosshair')}
        onDblClick={() => {
          if (tool === 'polygon' && polygonRef.current.length >= 3) closePolygon()
        }}
      />
      {(polygonCount > 0 || pendingCurve) && (
        <div className="editor-prompt">
          {pendingCurve ? (
            <>
              <span>Open curve side</span>
              <button type="button" onClick={() => commitCurve('a')}>A · left</button>
              <button type="button" onClick={() => commitCurve('b')}>B · right</button>
              <button type="button" onClick={() => { setPendingCurve(null); scheduleDraw() }}>Cancel</button>
            </>
          ) : (
            <>
              <span>Polygon · {polygonCount} points</span>
              <button type="button" onClick={closePolygon}>Close</button>
              <button type="button" onClick={() => { polygonRef.current = polygonRef.current.slice(0, -1); setPolygonCount(polygonRef.current.length); scheduleDraw() }}>Undo</button>
              <button type="button" onClick={() => { polygonRef.current = []; hoverRef.current = null; setPolygonCount(0); scheduleDraw() }}>Cancel</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

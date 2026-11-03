import { signal } from '@preact/signals'
import type { GenerationModel } from './generation-state'
import type { AreaShape, Generation, SortArea } from './types'

export type ShapeTool = 'select' | 'rect' | 'ellipse' | 'polygon' | 'lasso' | 'curve'
export type RightTab = 'text' | 'areas'

export const AREA_COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff9f1c']

export function createEditorModel() {
  return {
    selectedId: signal<string | null>(null),
    tool: signal<ShapeTool>('select'),
    maskPreview: signal(false),
    canvasSize: signal({ width: 0, height: 0 }),
    tab: signal<RightTab>('text'),
  }
}

export type EditorModel = ReturnType<typeof createEditorModel>

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

export function translateShape(shape: AreaShape, dx: number, dy: number): AreaShape {
  if (shape.kind === 'rect') return { ...shape, x: shape.x + dx, y: shape.y + dy }
  if (shape.kind === 'ellipse') return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy }
  return { ...shape, points: shape.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
}

export function copyShape(shape: AreaShape): AreaShape {
  if (shape.kind === 'path') return { ...shape, points: shape.points.map((point) => ({ ...point })) }
  return { ...shape }
}

function nextAreaId(areas: SortArea[]): { id: string; index: number } {
  const used = new Set(areas.map((area) => area.id))
  let index = 1
  while (used.has(`a${index}`)) index++
  return { id: `a${index}`, index }
}

export function createSortArea(shape: AreaShape, generation: Generation): SortArea {
  const { id, index } = nextAreaId(generation.areas)
  return {
    id,
    label: `Area ${index}`,
    color: AREA_COLORS[(index - 1) % AREA_COLORS.length],
    visible: true,
    shape,
    edge: { feather: 0, jitter: 0, mode: 'blend' },
    sort: {
      direction: generation.colorSortDirection,
      reverse: false,
      amount: generation.colorSortAmount,
    },
    opacity: 100,
  }
}

export function addArea(model: GenerationModel, area: SortArea) {
  model.setField('areas', [...model.draft.value.areas, area])
}

export function updateArea(model: GenerationModel, id: string, update: (area: SortArea) => SortArea) {
  model.setField('areas', model.draft.value.areas.map((area) => (area.id === id ? update(area) : area)))
}

export function removeArea(model: GenerationModel, id: string) {
  model.setField('areas', model.draft.value.areas.filter((area) => area.id !== id))
  if (model.draft.value.soloAreaId === id) model.setField('soloAreaId', '')
}

export function duplicateArea(model: GenerationModel, id: string): SortArea | null {
  const areas = model.draft.value.areas
  const index = areas.findIndex((area) => area.id === id)
  if (index === -1) return null
  const source = areas[index]
  const copy: SortArea = {
    ...source,
    id: nextAreaId(areas).id,
    shape: copyShape(source.shape),
    edge: { ...source.edge },
    sort: { ...source.sort },
  }
  model.setField('areas', [...areas.slice(0, index + 1), copy, ...areas.slice(index + 1)])
  return copy
}

export function moveArea(model: GenerationModel, id: string, offset: number) {
  const areas = model.draft.value.areas
  const index = areas.findIndex((area) => area.id === id)
  const target = index + offset
  if (index === -1 || target < 0 || target >= areas.length) return
  const next = [...areas]
  const [area] = next.splice(index, 1)
  next.splice(target, 0, area)
  model.setField('areas', next)
}

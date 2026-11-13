import { signal } from '@preact/signals'
import { DEFAULT_FONT } from './fonts'
import { MAX_LAYERS, type GenerationModel } from './generation-state'
import { defaultParams, effectLabel } from './effects'
import { LAYER_COLORS } from './types'
import type { AreaShape, EffectId, EffectLayer, EffectParams, Generation, Layer, TextAlign, TextLayer, TextVAlign } from './types'

// Shape clamping is shape math, so it lives with the masks in areas.ts and is
// re-exported here for the editor call sites.
export { clamp01, clampShape } from './areas'

export type ShapeTool = 'select' | 'rect' | 'ellipse' | 'polygon' | 'lasso' | 'curve'
export type TextField = 'text' | 'align' | 'vAlign' | 'x' | 'y' | 'size' | 'font' | 'opacity'

export function createEditorModel() {
  return {
    selectedLayerId: signal<string | null>(null),
    tool: signal<ShapeTool>('select'),
    maskPreview: signal(false),
    showMasks: signal(true),
    canvasSize: signal({ width: 0, height: 0 }),
    // The area the composition owns inside the base canvas; the frame sits
    // outside it and shapes are normalised against it.
    contentRect: signal({ x: 0, y: 0, width: 0, height: 0 }),
    // The effect a newly drawn shape creates.
    newEffect: signal<EffectId>('pixel-sort'),
  }
}

export type EditorModel = ReturnType<typeof createEditorModel>

export function translateShape(shape: AreaShape, dx: number, dy: number): AreaShape {
  if (shape.kind === 'rect') return { ...shape, x: shape.x + dx, y: shape.y + dy }
  if (shape.kind === 'ellipse') return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy }
  return { ...shape, points: shape.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
}

export function copyShape(shape: AreaShape): AreaShape {
  if (shape.kind === 'path') return { ...shape, points: shape.points.map((point) => ({ ...point })) }
  return { ...shape }
}

function nextLayerId(layers: Layer[], prefix: string): { id: string; index: number } {
  const used = new Set(layers.map((layer) => layer.id))
  let index = 1
  while (used.has(`${prefix}${index}`)) index++
  return { id: `${prefix}${index}`, index }
}

export function createEffectLayer(shape: AreaShape, generation: Generation, effect: EffectId): EffectLayer {
  const { id, index } = nextLayerId(generation.layers, 'e')
  return {
    kind: 'effect',
    id,
    label: `Effect ${index}`,
    visible: true,
    opacity: 100,
    color: LAYER_COLORS[(index - 1) % LAYER_COLORS.length],
    shape: copyShape(shape),
    edge: { feather: 0, jitter: 0, mode: 'blend' },
    effect,
    params: defaultParams(effect),
  }
}

export function createTextLayer(generation: Generation): TextLayer {
  const { id, index } = nextLayerId(generation.layers, 't')
  return {
    kind: 'text',
    id,
    label: `Text ${index}`,
    visible: true,
    opacity: 100,
    text: '',
    align: 'left',
    vAlign: 'bottom',
    x: 5,
    y: 95,
    size: 100,
    font: DEFAULT_FONT,
  }
}

export function addLayer(model: GenerationModel, layer: Layer): boolean {
  const layers = model.draft.value.layers
  if (layers.length >= MAX_LAYERS) return false
  model.setField('layers', [...layers, layer])
  return true
}

export function updateLayer(model: GenerationModel, id: string, update: (layer: Layer) => Layer) {
  model.setField('layers', model.draft.value.layers.map((layer) => (layer.id === id ? update(layer) : layer)))
}

export function updateEffectLayer(model: GenerationModel, id: string, update: (layer: EffectLayer) => EffectLayer) {
  updateLayer(model, id, (layer) => (layer.kind === 'effect' ? update(layer) : layer))
}

export function removeLayer(model: GenerationModel, id: string) {
  const generation = model.draft.value
  model.setField('layers', generation.layers.filter((layer) => layer.id !== id))
  if (generation.soloLayerId === id) model.setField('soloLayerId', '')
}

function copyLayer(layer: Layer, id: string): Layer {
  if (layer.kind === 'text') return { ...layer, id }
  return { ...layer, id, shape: copyShape(layer.shape), edge: { ...layer.edge }, params: { ...layer.params } }
}

export function duplicateLayer(model: GenerationModel, id: string): Layer | null {
  const layers = model.draft.value.layers
  const index = layers.findIndex((layer) => layer.id === id)
  if (index === -1 || layers.length >= MAX_LAYERS) return null
  const copy = copyLayer(layers[index], nextLayerId(layers, layers[index].kind === 'text' ? 't' : 'e').id)
  model.setField('layers', [...layers.slice(0, index + 1), copy, ...layers.slice(index + 1)])
  return copy
}

export function moveLayer(model: GenerationModel, id: string, to: number) {
  const layers = model.draft.value.layers
  const from = layers.findIndex((layer) => layer.id === id)
  const target = Math.max(0, Math.min(layers.length - 1, to))
  if (from === -1 || from === target) return
  const next = [...layers]
  const [layer] = next.splice(from, 1)
  next.splice(target, 0, layer)
  model.setField('layers', next)
}

export function updateTextLayerField(model: GenerationModel, id: string, field: TextField, value: string) {
  updateLayer(model, id, (layer) => {
    if (layer.kind !== 'text') return layer
    if (field === 'text') return { ...layer, text: value.toUpperCase() }
    if (field === 'align') {
      const align = value as TextAlign
      return { ...layer, align, x: align === 'left' ? 5 : align === 'right' ? 95 : 50 }
    }
    if (field === 'vAlign') {
      const vAlign = value as TextVAlign
      return { ...layer, vAlign, y: vAlign === 'top' ? 5 : vAlign === 'bottom' ? 95 : 50 }
    }
    if (field === 'font') return { ...layer, font: value }
    if (value.trim() === '') return layer
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return layer
    if (field === 'x' || field === 'y') return { ...layer, [field]: Math.min(100, Math.max(0, parsed)) }
    if (field === 'size') return { ...layer, size: Math.min(3000, Math.max(10, parsed)) }
    return { ...layer, opacity: Math.min(100, Math.max(0, parsed)) }
  })
}

export function updateEffectParams(model: GenerationModel, id: string, key: keyof EffectParams, value: number | string | boolean) {
  updateEffectLayer(model, id, (layer) => ({
    ...layer,
    params: { ...layer.params, [key]: value } as EffectParams,
  }))
}

export function setEffect(model: GenerationModel, id: string, effect: EffectId) {
  updateEffectLayer(model, id, (layer) => ({
    ...layer,
    effect,
    label: layer.label === effectLabel(layer.effect) ? effectLabel(effect) : layer.label,
    params: defaultParams(effect),
  }))
}

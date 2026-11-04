import { signal } from '@preact/signals'
import { clampShape, hashString } from './areas'
import { DEFAULT_GENERATION, DEFAULT_EFFECT_PARAMS, LAYER_COLORS } from './types'
import { DEFAULT_FONT, FONTS } from './fonts'
import { effectLabel, normalizeEffectId, sanitizeParams } from './effects'
import type {
  AreaShape,
  ColorSortDirection,
  EdgeMode,
  EffectLayer,
  EffectParams,
  Generation,
  Layer,
  Pt,
  TextAlign,
  TextLayer,
  TextVAlign,
} from './types'

export const MAX_LAYERS = 20

const INLINE_LAYERS_LIMIT = 6000
const LAYERS_STORAGE_PREFIX = 'layers:'
// Stored payloads are content addressed, so a run of large stacks would grow
// without bound. Keep the most recent few for back navigation.
const LAYERS_STORAGE_KEEP = 8

const legacyTextKeys = [
  { text: 'text', align: 'textAlign', vAlign: 'textVAlign', x: 'textX', y: 'textY', size: 'textSize', font: 'font', opacity: 'textOpacity' },
  { text: 'text2', align: 'text2Align', vAlign: 'text2VAlign', x: 'text2X', y: 'text2Y', size: 'text2Size', font: 'text2Font', opacity: 'text2Opacity' },
] as const

const LEGACY_PARAM_KEYS = [
  'draw',
  'texts',
  'areas',
  'areasMode',
  'soloAreaId',
  'grayLevels',
  'colorSortAmount',
  'colorSortDirection',
  'sectionCount',
  'sectionOffset',
  'sectionDirection',
  'sectionInvertRatio',
  'sectionPosterizeRatio',
  'detailNoiseMode',
  ...legacyTextKeys.flatMap((keys) => Object.values(keys)),
]

const numericFields = new Set<keyof Generation>(['seed', 'cropX', 'cropY', 'cropSize'])
const booleanFields = new Set<keyof Generation>(['cropPreview'])

const generationKeys = (Object.keys(DEFAULT_GENERATION) as (keyof Generation)[]).filter((key) => key !== 'layers')

const knownFonts = new Set(FONTS.map((font) => font.path))
const alignments = new Set<TextAlign>(['left', 'center', 'right'])
const verticalAlignments = new Set<TextVAlign>(['top', 'center', 'bottom'])
const colorPattern = /^#[0-9a-f]{6}$/i
const cropFormats = new Set<Generation['cropFormat']>(['original', 'square', 'portrait', 'landscape', 'wide'])

type LegacyText = {
  text: string
  align: TextAlign
  vAlign: TextVAlign
  x: number
  y: number
  size: number
  font: string
  opacity: number
}

type LegacyArea = {
  id: string
  label: string
  color: string
  visible: boolean
  shape: AreaShape
  edge: { feather: number; jitter: number; mode: EdgeMode }
  direction: ColorSortDirection
  reverse: boolean
  randomness: number
  opacity: number
}

type LegacySource = { get: (key: string) => string | number | undefined }

type LegacyInput = {
  draw?: string
  texts: LegacyText[]
  areas: LegacyArea[]
  soloAreaId: string
  params: EffectParams
}

function numberOrDefault(value: string, fallback: number) {
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function readParam(params: URLSearchParams, key: keyof Generation) {
  const value = params.get(key)
  if (value === null) return DEFAULT_GENERATION[key]
  if (numericFields.has(key)) return numberOrDefault(value, DEFAULT_GENERATION[key] as number)
  if (booleanFields.has(key)) return value === 'true'
  return value
}

function sanitizeNumber(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  return Math.max(min, Math.min(max, sanitizeNumber(value, fallback)))
}

function defaultTextLayer(index: number): TextLayer {
  const layers = DEFAULT_GENERATION.layers.filter((layer): layer is TextLayer => layer.kind === 'text')
  return layers[Math.min(Math.max(index, 0), layers.length - 1)]
}

function defaultLegacyText(index: number): LegacyText {
  const layer = defaultTextLayer(index)
  return {
    text: layer.text,
    align: layer.align,
    vAlign: layer.vAlign,
    x: layer.x,
    y: layer.y,
    size: layer.size,
    font: layer.font,
    opacity: layer.opacity,
  }
}

function defaultLegacyTexts(): LegacyText[] {
  return DEFAULT_GENERATION.layers
    .filter((layer): layer is TextLayer => layer.kind === 'text')
    .map((layer) => ({
      text: layer.text,
      align: layer.align,
      vAlign: layer.vAlign,
      x: layer.x,
      y: layer.y,
      size: layer.size,
      font: layer.font,
      opacity: layer.opacity,
    }))
}

function sanitizeLegacyText(value: unknown, index: number): LegacyText {
  const fallback = defaultLegacyText(index)
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const align = source.align as TextAlign
  const vAlign = source.vAlign as TextVAlign
  const font = source.font as string
  return {
    text: typeof source.text === 'string' ? source.text : fallback.text,
    align: alignments.has(align) ? align : fallback.align,
    vAlign: verticalAlignments.has(vAlign) ? vAlign : fallback.vAlign,
    x: clampNumber(source.x, 0, 100, fallback.x),
    y: clampNumber(source.y, 0, 100, fallback.y),
    size: clampNumber(source.size, 10, 3000, fallback.size),
    font: knownFonts.has(font) ? font : DEFAULT_FONT,
    opacity: clampNumber(source.opacity, 0, 100, fallback.opacity),
  }
}

function parseLegacyTexts(value: unknown[]): LegacyText[] {
  return value.map((layer, index) => sanitizeLegacyText(layer, index))
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

function jsonFromBase64Url(value: string): unknown {
  try {
    return JSON.parse(fromBase64Url(value))
  } catch {
    return null
  }
}

function numeric(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseShape(value: unknown): AreaShape | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>

  if (record.kind === 'rect') {
    const x = numeric(record, 'x')
    const y = numeric(record, 'y')
    const w = numeric(record, 'w')
    const h = numeric(record, 'h')
    if (x === null || y === null || w === null || h === null) return null
    return clampShape({ kind: 'rect', x, y, w, h, rotation: numeric(record, 'rotation') ?? 0 })
  }

  if (record.kind === 'ellipse') {
    const cx = numeric(record, 'cx')
    const cy = numeric(record, 'cy')
    const rx = numeric(record, 'rx')
    const ry = numeric(record, 'ry')
    if (cx === null || cy === null || rx === null || ry === null) return null
    return clampShape({ kind: 'ellipse', cx, cy, rx, ry, rotation: numeric(record, 'rotation') ?? 0 })
  }

  if (record.kind === 'path') {
    if (!Array.isArray(record.points)) return null
    const points: Pt[] = []
    for (const point of record.points) {
      if (typeof point !== 'object' || point === null) return null
      const x = numeric(point as Record<string, unknown>, 'x')
      const y = numeric(point as Record<string, unknown>, 'y')
      if (x === null || y === null) return null
      points.push({ x, y })
    }
    return clampShape({
      kind: 'path',
      closed: record.closed === true,
      side: record.side === 'b' ? 'b' : 'a',
      tension: numeric(record, 'tension') ?? 0,
      points,
    })
  }

  return null
}

function parseEdge(value: unknown): { feather: number; jitter: number; mode: EdgeMode } {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    feather: clampNumber(record.feather, 0, 100, 0),
    jitter: clampNumber(record.jitter, 0, 100, 0),
    mode: record.mode === 'ragged' ? 'ragged' : 'blend',
  }
}

function parseEffectLayer(record: Record<string, unknown>, id: string, index: number): EffectLayer | null {
  const shape = parseShape(record.shape)
  if (!shape) return null
  const effect = normalizeEffectId(record.effect)
  const color = typeof record.color === 'string' && colorPattern.test(record.color)
    ? record.color
    : LAYER_COLORS[index % LAYER_COLORS.length]
  return {
    kind: 'effect',
    id,
    label: typeof record.label === 'string' ? record.label : effectLabel(effect),
    visible: record.visible !== false,
    opacity: clampNumber(record.opacity, 0, 100, 100),
    color,
    shape,
    edge: parseEdge(record.edge),
    effect,
    params: sanitizeParams(effect, record.params),
  }
}

function parseTextLayer(record: Record<string, unknown>, id: string, index: number): TextLayer {
  const fallback = defaultTextLayer(index)
  const align = record.align as TextAlign
  const vAlign = record.vAlign as TextVAlign
  const font = record.font as string
  return {
    kind: 'text',
    id,
    label: typeof record.label === 'string' ? record.label : `Text ${index + 1}`,
    visible: record.visible !== false,
    opacity: clampNumber(record.opacity, 0, 100, 100),
    text: typeof record.text === 'string' ? record.text : '',
    align: alignments.has(align) ? align : fallback.align,
    vAlign: verticalAlignments.has(vAlign) ? vAlign : fallback.vAlign,
    x: clampNumber(record.x, 0, 100, fallback.x),
    y: clampNumber(record.y, 0, 100, fallback.y),
    size: clampNumber(record.size, 10, 3000, fallback.size),
    font: knownFonts.has(font) ? font : DEFAULT_FONT,
  }
}

function parseLayer(value: unknown, index: number): Layer | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id.length > 0 ? record.id : `l${index + 1}`
  if (record.kind === 'effect') return parseEffectLayer(record, id, index)
  if (record.kind === 'text') return parseTextLayer(record, id, index)
  return null
}

function sanitizeLayers(value: unknown[]): Layer[] {
  const layers: Layer[] = []
  const used = new Set<string>()
  for (const item of value) {
    const layer = parseLayer(item, layers.length)
    if (!layer) continue
    let id = layer.id
    let suffix = 2
    while (used.has(id)) id = `${layer.id}-${suffix++}`
    used.add(id)
    layers.push({ ...layer, id })
    if (layers.length >= MAX_LAYERS) break
  }
  return layers
}

function sanitizeSoloLayerId(value: unknown, layers: Layer[]): string {
  return typeof value === 'string' && layers.some((layer) => layer.id === value) ? value : ''
}

function quantize(value: number): number {
  return Math.round(value * 1e4) / 1e4
}

function compactPoints(points: Pt[]): Pt[] {
  const compact: Pt[] = []
  for (const point of points) {
    const next = { x: quantize(point.x), y: quantize(point.y) }
    const last = compact[compact.length - 1]
    if (last && last.x === next.x && last.y === next.y) continue
    compact.push(next)
  }
  return compact
}

function compactShape(shape: AreaShape): AreaShape {
  if (shape.kind === 'rect') {
    return {
      kind: 'rect',
      x: quantize(shape.x),
      y: quantize(shape.y),
      w: quantize(shape.w),
      h: quantize(shape.h),
      rotation: quantize(shape.rotation),
    }
  }
  if (shape.kind === 'ellipse') {
    return {
      kind: 'ellipse',
      cx: quantize(shape.cx),
      cy: quantize(shape.cy),
      rx: quantize(shape.rx),
      ry: quantize(shape.ry),
      rotation: quantize(shape.rotation),
    }
  }
  return {
    kind: 'path',
    closed: shape.closed,
    side: shape.side,
    tension: quantize(shape.tension),
    points: compactPoints(shape.points),
  }
}

function compactParams(params: EffectParams): EffectParams {
  return {
    grayLevels: params.grayLevels,
    direction: params.direction,
    reverse: params.reverse,
    randomness: quantize(params.randomness),
    spanWidth: params.spanWidth,
    amount: params.amount === null ? null : quantize(params.amount),
    sectionCount: params.sectionCount,
    sectionOffset: quantize(params.sectionOffset),
    sectionDirection: params.sectionDirection,
    sectionInvertRatio: quantize(params.sectionInvertRatio),
    sectionPosterizeRatio: quantize(params.sectionPosterizeRatio),
    detailNoiseMode: params.detailNoiseMode,
  }
}

function compactLayer(layer: Layer): Layer {
  const base = { id: layer.id, label: layer.label, visible: layer.visible, opacity: quantize(layer.opacity) }
  if (layer.kind === 'text') {
    return {
      ...base,
      kind: 'text',
      text: layer.text,
      align: layer.align,
      vAlign: layer.vAlign,
      x: quantize(layer.x),
      y: quantize(layer.y),
      size: quantize(layer.size),
      font: layer.font,
    }
  }
  return {
    ...base,
    kind: 'effect',
    color: layer.color,
    shape: compactShape(layer.shape),
    edge: { feather: quantize(layer.edge.feather), jitter: quantize(layer.edge.jitter), mode: layer.edge.mode },
    effect: layer.effect,
    params: compactParams(layer.params),
  }
}

function compactLayers(layers: Layer[]): string {
  return JSON.stringify(layers.map(compactLayer))
}

function decodeLayers(value: string): Layer[] | null {
  const payload = jsonFromBase64Url(value)
  if (!Array.isArray(payload)) return null
  return sanitizeLayers(payload)
}

function readStoredLayers(id: string): Layer[] | null {
  try {
    const stored = localStorage.getItem(LAYERS_STORAGE_PREFIX + id)
    if (!stored) return null
    const payload: unknown = JSON.parse(stored)
    return Array.isArray(payload) ? sanitizeLayers(payload) : null
  } catch {
    return null
  }
}

function resolveLayers(value: string): Layer[] | null {
  return decodeLayers(value) ?? readStoredLayers(value)
}

function persistLayers(layers: Layer[]): string {
  const payload = compactLayers(layers)
  const encoded = toBase64Url(payload)
  if (encoded.length <= INLINE_LAYERS_LIMIT) return encoded
  const id = `${hashString(payload).toString(36)}${payload.length.toString(36)}`
  try {
    localStorage.setItem(LAYERS_STORAGE_PREFIX + id, payload)
    pruneStoredLayers(id)
    return id
  } catch {
    // A quota failure falls back to the inline value, however long.
    return encoded
  }
}

function pruneStoredLayers(keep: string) {
  const stale: string[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key && key.startsWith(LAYERS_STORAGE_PREFIX) && key !== LAYERS_STORAGE_PREFIX + keep) stale.push(key)
  }
  while (stale.length >= LAYERS_STORAGE_KEEP) {
    const oldest = stale.shift()
    if (oldest) localStorage.removeItem(oldest)
  }
}

function sourceFromParams(params: URLSearchParams): LegacySource {
  return { get: (key) => params.get(key) ?? undefined }
}

function sourceFromRecord(record: Record<string, unknown>): LegacySource {
  return {
    get: (key) => {
      const value = record[key]
      return typeof value === 'string' || typeof value === 'number' ? value : undefined
    },
  }
}

function readLegacyTexts(source: LegacySource): LegacyText[] | null {
  const hasLegacy = legacyTextKeys.some((keys) => Object.values(keys).some((key) => source.get(key) !== undefined))
  if (!hasLegacy) return null
  return legacyTextKeys.map((keys, index) => sanitizeLegacyText({
    text: source.get(keys.text),
    align: source.get(keys.align),
    vAlign: source.get(keys.vAlign),
    x: source.get(keys.x),
    y: source.get(keys.y),
    size: source.get(keys.size),
    font: source.get(keys.font),
    opacity: source.get(keys.opacity),
  }, index))
}

function resolveLegacyTexts(value: string | null, source: LegacySource): LegacyText[] | null {
  if (value !== null) {
    const payload = jsonFromBase64Url(value)
    const decoded = Array.isArray(payload) ? parseLegacyTexts(payload) : null
    // The old reader treated an empty texts payload as absent.
    if (decoded && decoded.length > 0) return decoded
    try {
      const stored = localStorage.getItem(`texts:${value}`)
      if (stored) {
        const payload: unknown = JSON.parse(stored)
        if (Array.isArray(payload) && payload.length > 0) return parseLegacyTexts(payload)
      }
    } catch {
      // Fall through to the per-layer text params.
    }
  }
  return readLegacyTexts(source)
}

function parseLegacyArea(value: unknown): LegacyArea | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string') return null
  const shape = parseShape(record.shape)
  if (!shape) return null

  const sortRecord = typeof record.sort === 'object' && record.sort !== null ? (record.sort as Record<string, unknown>) : {}
  // Stored areas used to carry the sorted share; the remainder becomes the random trim.
  const legacyAmount = numeric(sortRecord, 'amount')
  const randomness = numeric(sortRecord, 'randomness') ?? (legacyAmount === null ? 0 : 100 - legacyAmount)

  return {
    id: record.id,
    label: typeof record.label === 'string' ? record.label : '',
    color: typeof record.color === 'string' ? record.color : '#ffffff',
    visible: record.visible !== false,
    shape,
    edge: parseEdge(record.edge),
    direction: sortRecord.direction === 'vertical' ? 'vertical' : 'horizontal',
    reverse: sortRecord.reverse === true,
    randomness,
    opacity: clampNumber(record.opacity, 0, 100, 100),
  }
}

function parseLegacyAreas(value: unknown[]): LegacyArea[] {
  const areas: LegacyArea[] = []
  for (const item of value) {
    const area = parseLegacyArea(item)
    if (area) areas.push(area)
  }
  return areas.slice(0, MAX_LAYERS)
}

function readStoredLegacyAreas(id: string): LegacyArea[] | null {
  try {
    const stored = localStorage.getItem(`areas:${id}`)
    if (!stored) return null
    const payload: unknown = JSON.parse(stored)
    return Array.isArray(payload) ? parseLegacyAreas(payload) : null
  } catch {
    return null
  }
}

function resolveLegacyAreas(value: string | null): LegacyArea[] {
  if (!value) return []
  const payload = jsonFromBase64Url(value)
  if (Array.isArray(payload)) return parseLegacyAreas(payload)
  return readStoredLegacyAreas(value) ?? []
}

function readLegacyEffectParams(source: LegacySource): EffectParams {
  const numericValue = (key: string) => {
    const value = source.get(key)
    if (value === undefined) return undefined
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const direction = source.get('colorSortDirection')
  return sanitizeParams('grey-squares', {
    grayLevels: numericValue('grayLevels'),
    direction: direction === 'vertical' || direction === 'horizontal' ? direction : undefined,
    amount: numericValue('colorSortAmount'),
    sectionCount: numericValue('sectionCount'),
    sectionOffset: numericValue('sectionOffset'),
    sectionDirection: source.get('sectionDirection'),
    sectionInvertRatio: numericValue('sectionInvertRatio'),
    sectionPosterizeRatio: numericValue('sectionPosterizeRatio'),
    detailNoiseMode: source.get('detailNoiseMode'),
  })
}

function migrateLayers(input: LegacyInput): { layers: Layer[]; soloLayerId: string } {
  const layers: Layer[] = []
  const soloIds = new Map<string, string>()

  if (input.draw === 'pixel-sort-areas') {
    // Text layers sit above the areas, so budget the areas against them instead
    // of letting the MAX_LAYERS truncation drop the text layers.
    const areaBudget = Math.max(0, MAX_LAYERS - input.texts.length)
    for (const area of input.areas.slice(0, areaBudget)) {
      const id = `e${layers.length + 1}`
      soloIds.set(area.id, id)
      layers.push({
        kind: 'effect',
        id,
        label: area.label || `Effect ${layers.length + 1}`,
        visible: area.visible,
        opacity: area.opacity,
        color: area.color,
        shape: area.shape,
        edge: area.edge,
        effect: 'pixel-sort',
        params: {
          ...DEFAULT_EFFECT_PARAMS,
          direction: area.direction,
          reverse: area.reverse,
          randomness: area.randomness,
        },
      })
    }
  } else if (input.draw === 'color-sorting') {
    layers.push({
      kind: 'effect',
      id: 'e1',
      label: effectLabel('pixel-sort'),
      visible: true,
      opacity: 100,
      color: LAYER_COLORS[0],
      shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1, rotation: 0 },
      edge: { feather: 0, jitter: 0, mode: 'blend' },
      effect: 'pixel-sort',
      params: {
        ...input.params,
        amount: input.params.amount ?? 100,
        reverse: false,
        randomness: 0,
      },
    })
  } else {
    const effect = normalizeEffectId(input.draw, 'grey-squares')
    layers.push({
      kind: 'effect',
      id: 'e1',
      label: effectLabel(effect),
      visible: true,
      opacity: 100,
      color: LAYER_COLORS[0],
      shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1, rotation: 0 },
      edge: { feather: 0, jitter: 0, mode: 'blend' },
      effect,
      params: input.params,
    })
  }

  input.texts.forEach((text, index) => {
    layers.push({
      kind: 'text',
      id: `t${index + 1}`,
      label: `Text ${index + 1}`,
      visible: true,
      opacity: text.opacity,
      text: text.text,
      align: text.align,
      vAlign: text.vAlign,
      x: text.x,
      y: text.y,
      size: text.size,
      font: text.font,
    })
  })

  return { layers: sanitizeLayers(layers), soloLayerId: soloIds.get(input.soloAreaId) ?? '' }
}

function hasLegacyParams(params: URLSearchParams): boolean {
  return LEGACY_PARAM_KEYS.some((key) => params.has(key))
}

function legacyInputFromParams(params: URLSearchParams): LegacyInput {
  const source = sourceFromParams(params)
  const texts = resolveLegacyTexts(params.get('texts'), source) ?? defaultLegacyTexts()
  return {
    draw: params.get('draw') ?? undefined,
    texts,
    areas: resolveLegacyAreas(params.get('areas')),
    soloAreaId: params.get('soloAreaId') ?? '',
    params: readLegacyEffectParams(source),
  }
}

function legacyInputFromRecord(record: Record<string, unknown>): LegacyInput {
  const source = sourceFromRecord(record)
  const savedTexts = Array.isArray(record.texts) && record.texts.length > 0 ? parseLegacyTexts(record.texts) : null
  return {
    draw: typeof record.draw === 'string' ? record.draw : undefined,
    texts: savedTexts ?? readLegacyTexts(source) ?? defaultLegacyTexts(),
    areas: Array.isArray(record.areas) ? parseLegacyAreas(record.areas) : [],
    soloAreaId: typeof record.soloAreaId === 'string' ? record.soloAreaId : '',
    params: readLegacyEffectParams(source),
  }
}

export function getGenerationFromURL(): Generation {
  const params = new URLSearchParams(window.location.search)
  const scalars = Object.fromEntries(
    generationKeys.map((key) => [key, readParam(params, key)]),
  ) as unknown as Omit<Generation, 'layers'>

  const encoded = params.get('layers')
  if (encoded !== null) {
    const layers = resolveLayers(encoded)
    if (layers) return { ...scalars, layers, soloLayerId: sanitizeSoloLayerId(scalars.soloLayerId, layers) }
  }
  if (hasLegacyParams(params)) {
    const migrated = migrateLayers(legacyInputFromParams(params))
    return { ...scalars, ...migrated }
  }
  return { ...scalars, layers: DEFAULT_GENERATION.layers, soloLayerId: '' }
}

function generationScalars(record: Record<string, unknown>): Omit<Generation, 'layers'> {
  const cropFormat = record.cropFormat as Generation['cropFormat']
  return {
    seed: sanitizeNumber(record.seed, DEFAULT_GENERATION.seed),
    image: typeof record.image === 'string' ? record.image : DEFAULT_GENERATION.image,
    cropFormat: cropFormats.has(cropFormat) ? cropFormat : DEFAULT_GENERATION.cropFormat,
    cropX: sanitizeNumber(record.cropX, DEFAULT_GENERATION.cropX),
    cropY: sanitizeNumber(record.cropY, DEFAULT_GENERATION.cropY),
    cropSize: sanitizeNumber(record.cropSize, DEFAULT_GENERATION.cropSize),
    cropPreview: record.cropPreview !== false && record.cropPreview !== 'false',
    soloLayerId: '',
  }
}

export function getGeneration(): Generation {
  if (window.location.search) return getGenerationFromURL()
  const stored = localStorage.getItem('generation')
  if (stored) {
    try {
      const saved = JSON.parse(stored) as Record<string, unknown>
      const scalars = generationScalars(saved)
      if (Array.isArray(saved.layers)) {
        const layers = sanitizeLayers(saved.layers)
        return { ...scalars, layers, soloLayerId: sanitizeSoloLayerId(saved.soloLayerId, layers) }
      }
      if (typeof saved.draw === 'string' || Array.isArray(saved.texts) || Array.isArray(saved.areas)) {
        return { ...scalars, ...migrateLayers(legacyInputFromRecord(saved)) }
      }
    } catch {
      return DEFAULT_GENERATION
    }
  }
  return DEFAULT_GENERATION
}

export function applyGeneration(gen: Generation) {
  try {
    localStorage.setItem('generation', JSON.stringify(gen))
  } catch {
    // A full quota must not block the render; the URL still carries the state.
  }
  const url = new URL(window.location.href)
  for (const key of generationKeys) {
    url.searchParams.set(key, String(gen[key]))
  }
  url.searchParams.set('layers', persistLayers(gen.layers))
  for (const key of LEGACY_PARAM_KEYS) url.searchParams.delete(key)
  window.location.href = url.toString()
}

export function createGenerationModel(initial: Generation) {
  const committed = signal(initial)
  const draft = signal({ ...initial })
  const draftListeners = new Set<(generation: Generation) => void>()
  const previewListeners = new Set<() => void>()
  const livePreview = signal(true)

  function setField<K extends keyof Generation>(field: K, value: Generation[K]) {
    draft.value = { ...draft.value, [field]: value }
    for (const listener of draftListeners) listener(draft.value)
  }

  function nextSeed() {
    applyGeneration({ ...draft.value, seed: draft.value.seed + 1 })
  }

  function commit(nextGeneration?: Generation) {
    const generation: Generation = nextGeneration ?? draft.value
    committed.value = { ...generation }
    applyGeneration(committed.value)
  }

  return {
    committed,
    draft,
    livePreview,
    requestPreview: () => {
      for (const listener of previewListeners) listener()
    },
    onPreview: (listener: () => void) => {
      previewListeners.add(listener)
      return () => previewListeners.delete(listener)
    },
    setField,
    subscribeDraft: (listener: (generation: Generation) => void) => {
      draftListeners.add(listener)
      return () => draftListeners.delete(listener)
    },
    nextSeed,
    applyGeneration: commit,
  }
}

export type GenerationModel = ReturnType<typeof createGenerationModel>

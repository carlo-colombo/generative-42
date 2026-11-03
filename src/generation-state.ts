import { signal } from '@preact/signals'
import { DEFAULT_GENERATION } from './types'
import { DEFAULT_FONT, FONTS } from './fonts'
import type { Generation, TextAlign, TextLayer, TextVAlign } from './types'

export type TextLayerField = keyof TextLayer

export const MAX_TEXT_LAYERS = 8

const INLINE_TEXTS_LIMIT = 1500
const TEXTS_STORAGE_PREFIX = 'texts:'

const legacyTextKeys = [
  { text: 'text', align: 'textAlign', vAlign: 'textVAlign', x: 'textX', y: 'textY', size: 'textSize', font: 'font', opacity: 'textOpacity' },
  { text: 'text2', align: 'text2Align', vAlign: 'text2VAlign', x: 'text2X', y: 'text2Y', size: 'text2Size', font: 'text2Font', opacity: 'text2Opacity' },
] as const

const numericFields = new Set<keyof Generation>([
  'seed',
  'grayLevels',
  'cropX',
  'cropY',
  'cropSize',
  'colorSortAmount',
  'sectionCount',
  'sectionOffset',
  'sectionInvertRatio',
  'sectionPosterizeRatio',
])

const booleanFields = new Set<keyof Generation>(['cropPreview'])

const generationKeys = (Object.keys(DEFAULT_GENERATION) as (keyof Generation)[]).filter((key) => key !== 'texts')

const knownFonts = new Set(FONTS.map((font) => font.path))

const alignments = new Set<TextAlign>(['left', 'center', 'right'])
const verticalAlignments = new Set<TextVAlign>(['top', 'center', 'bottom'])

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

function defaultTextLayer(index: number): TextLayer {
  const layers = DEFAULT_GENERATION.texts
  return layers[Math.min(Math.max(index, 0), layers.length - 1)]
}

function sanitizeNumber(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function sanitizeTextLayer(value: unknown, index: number): TextLayer {
  const fallback = defaultTextLayer(index)
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const align = source.align as TextAlign
  const vAlign = source.vAlign as TextVAlign
  const font = source.font as string
  return {
    text: typeof source.text === 'string' ? source.text : fallback.text,
    align: alignments.has(align) ? align : fallback.align,
    vAlign: verticalAlignments.has(vAlign) ? vAlign : fallback.vAlign,
    x: sanitizeNumber(source.x, fallback.x),
    y: sanitizeNumber(source.y, fallback.y),
    size: sanitizeNumber(source.size, fallback.size),
    font: knownFonts.has(font) ? font : DEFAULT_FONT,
    opacity: sanitizeNumber(source.opacity, fallback.opacity),
  }
}

function sanitizeTexts(value: unknown[]): TextLayer[] {
  return value.slice(0, MAX_TEXT_LAYERS).map((layer, index) => sanitizeTextLayer(layer, index))
}

function toBase64Url(value: string) {
  let binary = ''
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = base64.length % 4
  const padded = remainder === 0 ? base64 : base64 + '='.repeat(4 - remainder)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

export function encodeTexts(layers: TextLayer[]): string {
  return toBase64Url(JSON.stringify(layers))
}

export function decodeTexts(value: string): TextLayer[] | null {
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as unknown
    if (!Array.isArray(parsed)) return null
    return sanitizeTexts(parsed)
  } catch {
    return null
  }
}

function readStoredTexts(id: string): TextLayer[] | null {
  try {
    const stored = localStorage.getItem(TEXTS_STORAGE_PREFIX + id)
    if (!stored) return null
    const parsed = JSON.parse(stored) as unknown
    return Array.isArray(parsed) ? sanitizeTexts(parsed) : null
  } catch {
    return null
  }
}

function readLegacyTexts(params: URLSearchParams): TextLayer[] | null {
  const hasLegacy = legacyTextKeys.some((keys) => Object.values(keys).some((key) => params.has(key)))
  if (!hasLegacy) return null
  return legacyTextKeys.map((keys, index) => sanitizeTextLayer({
    text: params.get(keys.text),
    align: params.get(keys.align),
    vAlign: params.get(keys.vAlign),
    x: params.get(keys.x),
    y: params.get(keys.y),
    size: params.get(keys.size),
    font: params.get(keys.font),
    opacity: params.get(keys.opacity),
  }, index))
}

function legacyTextParams(source: Record<string, unknown>) {
  const params = new URLSearchParams()
  for (const keys of legacyTextKeys) {
    for (const key of Object.values(keys)) {
      const value = source[key]
      if (typeof value === 'string' || typeof value === 'number') params.set(key, String(value))
    }
  }
  return params
}

function readTexts(params: URLSearchParams): TextLayer[] {
  const encoded = params.get('texts')
  if (encoded !== null) {
    const layers = decodeTexts(encoded) ?? readStoredTexts(encoded)
    if (layers && layers.length > 0) return layers
  }
  return readLegacyTexts(params) ?? DEFAULT_GENERATION.texts
}

function persistTexts(layers: TextLayer[]): string {
  const encoded = encodeTexts(layers)
  if (encoded.length <= INLINE_TEXTS_LIMIT) return encoded
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  localStorage.setItem(TEXTS_STORAGE_PREFIX + id, JSON.stringify(layers))
  return id
}

export function getGenerationFromURL(): Generation {
  const params = new URLSearchParams(window.location.search)
  const generation = Object.fromEntries(
    generationKeys.map((key) => [key, readParam(params, key)]),
  ) as unknown as Generation
  return { ...generation, texts: readTexts(params) }
}

export function getGeneration(): Generation {
  if (window.location.search) return getGenerationFromURL()
  const stored = localStorage.getItem('generation')
  if (stored) {
    try {
      const saved = JSON.parse(stored)
      const savedTexts = Array.isArray(saved.texts) && saved.texts.length > 0 ? sanitizeTexts(saved.texts) : null
      return {
        ...DEFAULT_GENERATION,
        ...saved,
        texts: savedTexts ?? readLegacyTexts(legacyTextParams(saved)) ?? DEFAULT_GENERATION.texts,
        cropPreview: saved.cropPreview !== false && saved.cropPreview !== 'false',
      }
    } catch {
      return DEFAULT_GENERATION
    }
  }
  return DEFAULT_GENERATION
}

export function applyGeneration(gen: Generation) {
  localStorage.setItem('generation', JSON.stringify(gen))
  const url = new URL(window.location.href)
  for (const key of generationKeys) {
    url.searchParams.set(key, String(gen[key]))
  }
  for (const keys of legacyTextKeys) {
    for (const key of Object.values(keys)) url.searchParams.delete(key)
  }
  url.searchParams.set('texts', persistTexts(gen.texts))
  window.location.href = url.toString()
}

export function createGenerationModel(initial: Generation) {
  const committed = signal(initial)
  const draft = signal({ ...initial })
  const draftListeners = new Set<(generation: Generation) => void>()

  function setField<K extends keyof Generation>(field: K, value: Generation[K]) {
    draft.value = { ...draft.value, [field]: value }
    for (const listener of draftListeners) listener(draft.value)
  }

  function getTextLayer(index: number) {
    return draft.value.texts[index] ?? defaultTextLayer(index)
  }

  function setTextLayerField(index: number, field: TextLayerField, value: string) {
    const layers = draft.value.texts
    const current = layers[index]
    if (!current) return
    let next: TextLayer
    if (field === 'text') next = { ...current, text: value.toUpperCase() }
    else if (field === 'align') next = { ...current, align: value as TextAlign, x: value === 'left' ? 5 : value === 'right' ? 95 : 50 }
    else if (field === 'vAlign') next = { ...current, vAlign: value as TextVAlign, y: value === 'top' ? 5 : value === 'bottom' ? 95 : 50 }
    else if (field === 'font') next = { ...current, font: value }
    else next = { ...current, [field]: numberOrDefault(value, defaultTextLayer(index)[field]) } as TextLayer
    setField('texts', layers.map((layer, position) => (position === index ? next : layer)))
  }

  function addTextLayer(layer?: Partial<TextLayer>) {
    const texts = draft.value.texts
    if (texts.length >= MAX_TEXT_LAYERS) return
    setField('texts', [...texts, sanitizeTextLayer(layer, texts.length)])
  }

  function removeTextLayer(index: number) {
    const texts = draft.value.texts
    if (texts.length <= 1 || index < 0 || index >= texts.length) return
    setField('texts', texts.filter((_, position) => position !== index))
  }

  function duplicateTextLayer(index: number) {
    const texts = draft.value.texts
    const source = texts[index]
    if (!source || texts.length >= MAX_TEXT_LAYERS) return
    setField('texts', [...texts.slice(0, index + 1), { ...source }, ...texts.slice(index + 1)])
  }

  function moveTextLayer(from: number, to: number) {
    const texts = draft.value.texts
    if (from === to || from < 0 || to < 0 || from >= texts.length || to >= texts.length) return
    const next = [...texts]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setField('texts', next)
  }

  function nextSeed() {
    applyGeneration({ ...draft.value, seed: draft.value.seed + 1 })
  }

  function commit(nextGeneration?: Generation) {
    const generation: Generation = nextGeneration ?? (draft.value as Generation)
    committed.value = { ...generation }
    applyGeneration(committed.value)
  }

  return {
    committed,
    draft,
    getTextLayer,
    setField,
    setTextLayerField,
    addTextLayer,
    removeTextLayer,
    duplicateTextLayer,
    moveTextLayer,
    subscribeDraft: (listener: (generation: Generation) => void) => {
      draftListeners.add(listener)
      return () => draftListeners.delete(listener)
    },
    nextSeed,
    applyGeneration: commit,
  }
}

export type GenerationModel = ReturnType<typeof createGenerationModel>

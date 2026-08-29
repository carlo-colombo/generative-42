import { signal } from '@preact/signals'
import { DEFAULT_GENERATION } from './types'
import type { Generation, TextAlign, TextVAlign } from './types'

export type TextLayer = {
  text: string
  align: TextAlign
  vAlign: TextVAlign
  x: number
  y: number
  size: number
  font: string
  opacity: number
}

export type TextLayerField = keyof TextLayer

const numericFields = new Set<keyof Generation>([
  'seed',
  'grayLevels',
  'textX',
  'textY',
  'textSize',
  'textOpacity',
  'text2X',
  'text2Y',
  'text2Size',
  'text2Opacity',
  'cropX',
  'cropY',
  'cropSize',
  'colorSortAmount',
])

const booleanFields = new Set<keyof Generation>(['cropPreview'])

const layerFields: Record<1 | 2, Record<TextLayerField, keyof Generation>> = {
  1: {
    text: 'text', align: 'textAlign', vAlign: 'textVAlign', x: 'textX', y: 'textY',
    size: 'textSize', font: 'font', opacity: 'textOpacity',
  },
  2: {
    text: 'text2', align: 'text2Align', vAlign: 'text2VAlign', x: 'text2X', y: 'text2Y',
    size: 'text2Size', font: 'text2Font', opacity: 'text2Opacity',
  },
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

export function getGenerationFromURL(): Generation {
  const params = new URLSearchParams(window.location.search)
  return Object.fromEntries(
    (Object.keys(DEFAULT_GENERATION) as (keyof Generation)[]).map((key) => [key, readParam(params, key)]),
  ) as unknown as Generation
}

export function getGeneration(): Generation {
  if (window.location.search) return getGenerationFromURL()
  const stored = localStorage.getItem('generation')
  if (stored) {
    try {
      const saved = JSON.parse(stored)
      return { ...DEFAULT_GENERATION, ...saved, cropPreview: saved.cropPreview !== false && saved.cropPreview !== 'false' }
    } catch {
      return DEFAULT_GENERATION
    }
  }
  return DEFAULT_GENERATION
}

export function applyGeneration(gen: Generation) {
  localStorage.setItem('generation', JSON.stringify(gen))
  const url = new URL(window.location.href)
  for (const key of Object.keys(gen) as (keyof Generation)[]) {
    url.searchParams.set(key, String(gen[key]))
  }
  window.location.href = url.toString()
}

function getTextLayer(generation: Generation, layer: 1 | 2): TextLayer {
  const keys = layerFields[layer]
  return {
    text: generation[keys.text] as string,
    align: generation[keys.align] as TextAlign,
    vAlign: generation[keys.vAlign] as TextVAlign,
    x: generation[keys.x] as number,
    y: generation[keys.y] as number,
    size: generation[keys.size] as number,
    font: generation[keys.font] as string,
    opacity: generation[keys.opacity] as number,
  }
}

export function createGenerationModel(initial: Generation) {
  const committed = signal(initial)
  const draft = signal({ ...initial })

  function setField<K extends keyof Generation>(field: K, value: Generation[K]) {
    draft.value = { ...draft.value, [field]: value }
  }

  function setTextLayerField(layer: 1 | 2, field: TextLayerField, value: string) {
    const key = layerFields[layer][field]
    let nextValue: Generation[typeof key]
    if (field === 'text') nextValue = value.toUpperCase() as Generation[typeof key]
    else if (field === 'align') nextValue = value as Generation[typeof key]
    else if (field === 'vAlign') nextValue = value as Generation[typeof key]
    else if (field === 'font') nextValue = value as Generation[typeof key]
    else {
      const fallback = getTextLayer(DEFAULT_GENERATION, layer)[field] as number
      nextValue = numberOrDefault(value, fallback) as Generation[typeof key]
    }
    setField(key, nextValue)

    if (field === 'align') {
      const position = value === 'left' ? 5 : value === 'right' ? 95 : 50
      setField(layerFields[layer].x, position as Generation[typeof layerFields[typeof layer]['x']])
    }
    if (field === 'vAlign') {
      const position = value === 'top' ? 5 : value === 'bottom' ? 95 : 50
      setField(layerFields[layer].y, position as Generation[typeof layerFields[typeof layer]['y']])
    }
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
    getTextLayer: (layer: 1 | 2) => getTextLayer(draft.value, layer),
    setField,
    setTextLayerField,
    nextSeed,
    applyGeneration: commit,
  }
}

export type GenerationModel = ReturnType<typeof createGenerationModel>

import { signal } from '@preact/signals'
import { copyShape } from './editor-state'
import { MAX_LAYERS, sanitizeLayers } from './generation-state'
import type { Layer } from './types'

// Named layer stacks live in this browser; the same payload can be written to
// a JSON file and read back on another machine.
export const PRESET_STORAGE_KEY = 'layer-presets'
export const PRESET_FILE_KIND = 'generative-42-layer-presets'
export const PRESET_FILE_VERSION = 1
const PRESET_NAME_LIMIT = 60

export type LayerPreset = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  layers: Layer[]
}

export type PresetLoadMode = 'append' | 'replace'

export type PresetSaveResult = {
  preset: LayerPreset | null
  replaced: boolean
  stored: boolean
}

export type PresetImportResult = {
  imported: number
  skipped: number
  error: string
  stored: boolean
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sanitizeName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.trim() : ''
  return name.length > 0 ? name.slice(0, PRESET_NAME_LIMIT) : fallback
}

function sanitizePreset(value: unknown, index: number): LayerPreset | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.layers)) return null
  const layers = sanitizeLayers(record.layers.slice(0, MAX_LAYERS))
  if (layers.length === 0) return null
  const now = Date.now()
  return {
    id: typeof record.id === 'string' && record.id.length > 0 ? record.id : `p${index + 1}`,
    name: sanitizeName(record.name, `PRESET ${index + 1}`),
    createdAt: numeric(record.createdAt, now),
    updatedAt: numeric(record.updatedAt, now),
    layers,
  }
}

export function sanitizePresets(payload: unknown): LayerPreset[] {
  let list: unknown[] | null = null
  if (Array.isArray(payload)) list = payload
  else if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.presets)) list = record.presets
  }
  if (!list) return []
  const presets: LayerPreset[] = []
  const used = new Set<string>()
  for (const item of list) {
    const preset = sanitizePreset(item, presets.length)
    if (!preset) continue
    let id = preset.id
    let suffix = 2
    while (used.has(id)) id = `${preset.id}-${suffix++}`
    used.add(id)
    presets.push({ ...preset, id })
  }
  return presets
}

function readStoredPresets(): LayerPreset[] {
  try {
    const stored = localStorage.getItem(PRESET_STORAGE_KEY)
    if (!stored) return []
    return sanitizePresets(JSON.parse(stored))
  } catch {
    return []
  }
}

function persist(items: LayerPreset[]): boolean {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify({ version: PRESET_FILE_VERSION, presets: items }))
    return true
  } catch {
    return false
  }
}

export const presets = signal<LayerPreset[]>(readStoredPresets())

function cloneLayer(layer: Layer, id: string): Layer {
  if (layer.kind === 'text') return { ...layer, id }
  return { ...layer, id, shape: copyShape(layer.shape), edge: { ...layer.edge }, params: { ...layer.params } }
}

function uniqueLayerId(layers: Layer[], prefix: string): string {
  const used = new Set(layers.map((layer) => layer.id))
  let index = 1
  while (used.has(`${prefix}${index}`)) index++
  return `${prefix}${index}`
}

function commit(items: LayerPreset[]): boolean {
  presets.value = items
  return persist(items)
}

function createPresetId(items: LayerPreset[]): string {
  const now = Date.now().toString(36)
  let index = 1
  let id = `p${now}`
  const used = new Set(items.map((preset) => preset.id))
  while (used.has(id)) id = `p${now}-${index++}`
  return id
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) return name
  let index = 1
  let candidate = `${name} (IMPORTED)`
  while (used.has(candidate.toLowerCase())) candidate = `${name} (IMPORTED ${++index})`
  return candidate
}

export function savePreset(name: string, layers: Layer[]): PresetSaveResult {
  const items = presets.value
  const fallback = `PRESET ${items.length + 1}`
  const presetName = sanitizeName(name, fallback)
  const cloned = layers.slice(0, MAX_LAYERS).map((layer) => cloneLayer(layer, layer.id))
  if (cloned.length === 0) return { preset: null, replaced: false, stored: true }
  const now = Date.now()
  const existing = items.find((preset) => preset.name.toLowerCase() === presetName.toLowerCase())
  if (existing) {
    const updated: LayerPreset = { ...existing, name: presetName, updatedAt: now, layers: cloned }
    const stored = commit(items.map((preset) => (preset.id === existing.id ? updated : preset)))
    return { preset: updated, replaced: true, stored }
  }
  const created: LayerPreset = { id: createPresetId(items), name: presetName, createdAt: now, updatedAt: now, layers: cloned }
  return { preset: created, replaced: false, stored: commit([...items, created]) }
}

export function duplicatePreset(id: string): LayerPreset | null {
  const items = presets.value
  const index = items.findIndex((preset) => preset.id === id)
  if (index === -1) return null
  const source = items[index]
  const used = new Set(items.map((preset) => preset.name.toLowerCase()))
  const now = Date.now()
  const copy: LayerPreset = {
    id: createPresetId(items),
    name: uniqueCopyName(source.name, used),
    createdAt: now,
    updatedAt: now,
    layers: source.layers.map((layer) => cloneLayer(layer, layer.id)),
  }
  commit([...items.slice(0, index + 1), copy, ...items.slice(index + 1)])
  return copy
}

function uniqueCopyName(name: string, used: Set<string>): string {
  let candidate = `${name} COPY`
  let index = 2
  while (used.has(candidate.toLowerCase())) candidate = `${name} COPY ${index++}`
  return candidate
}

export function renamePreset(id: string, name: string): boolean {
  const items = presets.value
  const target = items.find((preset) => preset.id === id)
  const trimmed = sanitizeName(name, '')
  if (!target || trimmed === '') return false
  const used = new Set(items.filter((preset) => preset.id !== id).map((preset) => preset.name.toLowerCase()))
  const unique = uniqueRename(trimmed, used)
  commit(items.map((preset) => (preset.id === id ? { ...preset, name: unique, updatedAt: Date.now() } : preset)))
  return true
}

function uniqueRename(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) return name
  let index = 2
  let candidate = `${name} ${index++}`
  while (used.has(candidate.toLowerCase())) candidate = `${name} ${index++}`
  return candidate
}

export function deletePreset(id: string) {
  commit(presets.value.filter((preset) => preset.id !== id))
}

export function layersForPreset(
  preset: LayerPreset,
  mode: PresetLoadMode,
  current: Layer[],
): { layers: Layer[]; added: Layer[] } {
  const base = mode === 'replace' ? [] : current.map((layer) => cloneLayer(layer, layer.id))
  const budget = Math.max(0, MAX_LAYERS - base.length)
  const added: Layer[] = []
  for (const layer of preset.layers.slice(0, budget)) {
    const clone = cloneLayer(layer, uniqueLayerId(base, layer.kind === 'text' ? 't' : 'e'))
    base.push(clone)
    added.push(clone)
  }
  return { layers: base, added }
}

export function presetFilePayload(items: LayerPreset[] = presets.value): string {
  return JSON.stringify({
    kind: PRESET_FILE_KIND,
    version: PRESET_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    presets: items.map((preset) => ({ name: preset.name, layers: preset.layers })),
  }, null, 2)
}

function nameFromFile(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').trim()
  return stem.length > 0 ? stem.slice(0, PRESET_NAME_LIMIT).toUpperCase() : 'IMPORTED'
}

// Accepts the exported file, a bare preset list, or a whole generation, so a
// stack pasted out of a URL or saved by hand still imports as one preset.
function presetsFromPayload(payload: unknown, fileName: string): LayerPreset[] {
  const listed = sanitizePresets(payload)
  if (listed.length > 0) return listed
  const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : null
  const rawLayers = Array.isArray(payload)
    ? payload
    : record && Array.isArray(record.layers)
      ? record.layers
      : null
  if (!rawLayers) return []
  const layers = sanitizeLayers(rawLayers.slice(0, MAX_LAYERS))
  if (layers.length === 0) return []
  const now = Date.now()
  return [{ id: 'imported', name: nameFromFile(fileName), createdAt: now, updatedAt: now, layers }]
}

export function importPresets(text: string, fileName = ''): PresetImportResult {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return { imported: 0, skipped: 0, error: 'That file is not JSON.', stored: true }
  }
  const incoming = presetsFromPayload(payload, fileName)
  if (incoming.length === 0) return { imported: 0, skipped: 0, error: 'No layer presets in that file.', stored: true }

  const items = presets.value
  const used = new Set(items.map((preset) => preset.name.toLowerCase()))
  const now = Date.now()
  const added: LayerPreset[] = []
  let skipped = 0
  for (const preset of incoming) {
    if (preset.layers.length === 0) {
      skipped++
      continue
    }
    const name = uniqueName(preset.name, used)
    used.add(name.toLowerCase())
    added.push({ ...preset, id: createPresetId([...items, ...added]), name, createdAt: now, updatedAt: now })
  }
  const stored = commit([...items, ...added])
  return { imported: added.length, skipped, error: '', stored }
}

import { useRef, useState } from 'preact/hooks'
import { MAX_LAYERS, type GenerationModel } from '../generation-state'
import type { EditorModel } from '../editor-state'
import {
  deletePreset,
  duplicatePreset,
  importPresets,
  layersForPreset,
  presetFilePayload,
  presets,
  renamePreset,
  savePreset,
  type LayerPreset,
  type PresetLoadMode,
} from '../presets'
import { ControlField } from './ControlField'
import { HelpPopover } from './HelpPopover'
import { Segmented } from './Segmented'

const PRESET_FILE_NAME = 'layer-presets.json'

function presetSummary(preset: LayerPreset) {
  const effects = preset.layers.filter((layer) => layer.kind === 'effect').length
  const texts = preset.layers.length - effects
  return [effects > 0 ? `${effects} fx` : '', texts > 0 ? `${texts} text` : ''].filter(Boolean).join(' · ')
}

export function Presets({ model, editor }: { model: GenerationModel; editor: EditorModel }) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<PresetLoadMode>('append')
  const [status, setStatus] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const items = presets.value
  const generation = model.draft.value
  const atCapacity = generation.layers.length >= MAX_LAYERS

  const save = () => {
    const result = savePreset(name, generation.layers)
    if (!result.preset) {
      setStatus('Nothing to save: the stack is empty.')
      return
    }
    setName('')
    setStatus(`${result.replaced ? 'Updated' : 'Saved'} ${result.preset.name}${result.stored ? '' : ' (storage full, not kept)'}`)
  }

  const load = (preset: LayerPreset) => {
    const draft = generation
    const result = layersForPreset(preset, mode, draft.layers)
    if (result.added.length === 0) {
      setStatus(`The stack is full (${MAX_LAYERS} layers).`)
      return
    }
    model.setField('layers', result.layers)
    if (draft.soloLayerId && !result.layers.some((layer) => layer.id === draft.soloLayerId)) model.setField('soloLayerId', '')
    editor.selectedLayerId.value = result.added[result.added.length - 1].id
    const count = `${result.added.length} layer${result.added.length === 1 ? '' : 's'}`
    setStatus(`${mode === 'replace' ? 'Loaded' : 'Added'} ${count} from ${preset.name}`)
  }

  const duplicate = (preset: LayerPreset) => {
    const copy = duplicatePreset(preset.id)
    if (copy) setStatus(`Duplicated as ${copy.name}`)
  }

  const remove = (preset: LayerPreset) => {
    deletePreset(preset.id)
    if (editingId === preset.id) setEditingId(null)
    setStatus(`Deleted ${preset.name}`)
  }

  const startRename = (preset: LayerPreset) => {
    setEditingId(preset.id)
    setEditingName(preset.name)
  }

  const commitRename = () => {
    if (!editingId) return
    if (renamePreset(editingId, editingName)) setStatus('Renamed preset.')
    setEditingId(null)
    setEditingName('')
  }

  const exportFile = () => {
    if (items.length === 0) return
    const blob = new Blob([presetFilePayload(items)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = PRESET_FILE_NAME
    anchor.click()
    URL.revokeObjectURL(url)
    setStatus(`Exported ${items.length} preset${items.length === 1 ? '' : 's'}.`)
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    const result = importPresets(await file.text(), file.name)
    if (result.error) setStatus(result.error)
    else setStatus(`Imported ${result.imported} preset${result.imported === 1 ? '' : 's'}${result.skipped > 0 ? `, skipped ${result.skipped}` : ''}${result.stored ? '' : ' (storage full, not kept)'}`)
  }

  return <section className="panel-section">
    <div className="section-heading">
      <h2 className="section-title">Layer presets</h2>
      <HelpPopover label="How presets work">
        <dl className="help-list">
          <dt>Save</dt>
          <dd>Stores the whole current stack, shapes and edge settings included, under a name in this browser. Saving over an existing name replaces that preset.</dd>
          <dt>Load</dt>
          <dd>Add puts the preset layers on top of the current stack; Replace swaps the whole stack for it. Seed, image and crop are never touched, so a preset lands on any image.</dd>
          <dt>Copy</dt>
          <dd>Duplicate keeps the original and appends a copy you can rename and edit.</dd>
          <dt>File</dt>
          <dd>Export writes every preset to a JSON file; Import merges a file back in, renaming clashes instead of overwriting.</dd>
        </dl>
      </HelpPopover>
    </div>
    <p className="hint-text">Named stacks saved in this browser; load one onto any image.</p>

    <ControlField label="Name">
      <input
        aria-label="Preset name"
        type="text"
        placeholder="STACK NAME"
        value={name}
        onInput={(event) => setName(event.currentTarget.value.toUpperCase())}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save()
        }}
      />
    </ControlField>
    <button type="button" onClick={save} disabled={generation.layers.length === 0}>
      Save current stack
    </button>

    <Segmented
      label="Load as"
      value={mode}
      options={[{ value: 'append', label: 'Add' }, { value: 'replace', label: 'Replace' }]}
      onChange={setMode}
    />
    {atCapacity && mode === 'append' && <p className="text-hint">Stack is full ({MAX_LAYERS} layers) — use Replace.</p>}

    {items.length === 0
      ? <p className="hint-text">No presets yet. Build a stack, name it, and save it.</p>
      : <ul className="preset-list">
        {items.map((preset) => <li key={preset.id} className={editingId === preset.id ? 'preset-row editing' : 'preset-row'}>
          {editingId === preset.id
            ? <input
              aria-label="Rename preset"
              className="preset-name-input"
              type="text"
              value={editingName}
              autoFocus
              onInput={(event) => setEditingName(event.currentTarget.value.toUpperCase())}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename()
                if (event.key === 'Escape') {
                  setEditingId(null)
                  setEditingName('')
                }
              }}
            />
            : <span className="preset-name" title={`${preset.name} · ${presetSummary(preset)}`}>
              <span className="preset-label">{preset.name}</span>
              <span className="preset-meta">{presetSummary(preset)}</span>
            </span>}
          <div className="layer-row-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={`Load ${preset.name}`}
              title={mode === 'replace' ? `Replace the stack with ${preset.name}` : `Add ${preset.name} to the stack`}
              onClick={() => load(preset)}
            >
              {mode === 'replace' ? '⇄' : '+'}
            </button>
            <button type="button" className="icon-button" aria-label={`Duplicate ${preset.name}`} title="Duplicate preset" onClick={() => duplicate(preset)}>⧉</button>
            <button type="button" className="icon-button" aria-label={`Rename ${preset.name}`} title="Rename preset" onClick={() => startRename(preset)}>✎</button>
            <button type="button" className="icon-button" aria-label={`Delete ${preset.name}`} title="Delete preset" onClick={() => remove(preset)}>✕</button>
          </div>
        </li>)}
      </ul>}

    <div className="add-row">
      <button type="button" onClick={exportFile} disabled={items.length === 0}>Export file</button>
      <button type="button" onClick={() => fileInput.current?.click()}>Import file</button>
    </div>
    <input
      ref={fileInput}
      type="file"
      accept="application/json,.json"
      aria-label="Import presets file"
      style={{ display: 'none' }}
      onChange={(event) => {
        const input = event.currentTarget
        const file = input.files?.[0]
        input.value = ''
        void importFile(file)
      }}
    />
    {status && <p className="text-hint" role="status">{status}</p>}
  </section>
}

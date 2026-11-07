import { useEffect, useState } from 'preact/hooks'
import type { EditorModel } from './editor-state'
import { addLayer, createEffectLayer, createTextLayer } from './editor-state'
import { MAX_LAYERS, type GenerationModel } from './generation-state'
import { EFFECT_LIST } from './effects'
import { Actions } from './components/Actions'
import { ControlField } from './components/ControlField'
import { CropControls } from './components/CropControls'
import { LayerControls } from './components/LayerControls'
import { LayerList } from './components/LayerList'
import { Presets } from './components/Presets'
import { SourceControls } from './components/SourceControls'
import { StageToolbar } from './components/ToolButtons'
import { UpdatePanel } from './components/UpdatePanel'
import { FULL_CANVAS_SHAPE, type EffectId } from './types'

import { appUrl } from './paths'

function useImages(model: GenerationModel) {
  const [images, setImages] = useState<string[]>([])
  const [manifestState, setManifestState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    fetch(appUrl('/assets/manifest.json'))
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load image manifest')
        return response.json() as Promise<string[]>
      })
      .then((files) => {
        const availableImages = files.length > 0 ? files : []
        setImages(availableImages)
        setManifestState('ready')
        const current = model.draft.value.image
        const missingBuiltIn = current.startsWith('/assets/') && !availableImages.includes(current.replace('/assets/', ''))
        if (missingBuiltIn && availableImages[0]) model.setField('image', `/assets/${availableImages[0]}`)
      })
      .catch(() => {
        setImages([])
        setManifestState('error')
      })
  }, [model])
  return { images, manifestState }
}

function generateOnEnter(model: GenerationModel) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey && ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) {
      event.preventDefault()
      model.applyGeneration()
    }
  }
}

export function LeftPanel({ model }: { model: GenerationModel }) {
  const { images, manifestState } = useImages(model)
  return <aside className="panel panel-left" onKeyDown={generateOnEnter(model)}>
    <header className="panel-header">
      <h1>Generative 42</h1>
      {manifestState === 'loading' && <p>Loading images...</p>}
      {manifestState === 'error' && <p>Image manifest unavailable; using the current image.</p>}
    </header>
    <div className="panel-scroll">
      <SourceControls model={model} images={images} />
      <CropControls model={model} />
    </div>
    <Actions model={model} />
  </aside>
}

export function RightPanel({ model, editor }: { model: GenerationModel; editor: EditorModel }) {
  const draft = model.draft.value
  const atCapacity = draft.layers.length >= MAX_LAYERS
  const newEffect = editor.newEffect.value
  const newEffectLabel = EFFECT_LIST.find((entry) => entry.id === newEffect)?.label ?? newEffect

  const addEffect = () => {
    if (atCapacity) return
    const layer = createEffectLayer(FULL_CANVAS_SHAPE, draft, newEffect)
    if (addLayer(model, layer)) editor.selectedLayerId.value = layer.id
  }

  const addText = () => {
    if (atCapacity) return
    const layer = createTextLayer(draft)
    if (addLayer(model, layer)) editor.selectedLayerId.value = layer.id
  }

  return <aside className="panel panel-right" onKeyDown={generateOnEnter(model)}>
    <header className="panel-header">
      <h1>Layers</h1>
    </header>
    <div className="panel-scroll">
      <LayerList model={model} editor={editor} />
      <LayerControls model={model} editor={editor} />
      <section className="panel-section">
        <h2 className="section-title">Draw layers</h2>
        <StageToolbar editor={editor} model={model} />
      </section>
      <section className="panel-section">
        <h2 className="section-title">Add layer</h2>
        <ControlField label="Effect">
          <select aria-label="New layer effect" value={newEffect} onChange={(event) => { editor.newEffect.value = event.currentTarget.value as EffectId }}>
            {EFFECT_LIST.map((entry) => <option value={entry.id}>{entry.label}</option>)}
          </select>
        </ControlField>
        <div className="add-row">
          <button type="button" onClick={addEffect} disabled={atCapacity}>Add effect</button>
          <button type="button" onClick={addText} disabled={atCapacity}>Add text</button>
        </div>
        {atCapacity && <p className="text-hint">Limit of {MAX_LAYERS} layers</p>}
        <p className="hint-text">Drawing a shape on the stage adds a {newEffectLabel} layer clipped to it. A full-canvas effect is a rect layer covering the whole frame.</p>
      </section>
      <Presets model={model} editor={editor} />
      <UpdatePanel />
      <section className="panel-section">
        <label className="checkbox-field">
          <input type="checkbox" checked={editor.maskPreview.value} disabled={!editor.showMasks.value} onChange={(event) => { editor.maskPreview.value = event.currentTarget.checked }} />
          Preview effect masks
        </label>
      </section>
    </div>
  </aside>
}

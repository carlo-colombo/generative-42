import { useEffect, useRef, useState } from 'preact/hooks'
import type { EditorModel, RightTab } from './editor-state'
import { MAX_AREAS, MAX_TEXT_LAYERS, type GenerationModel } from './generation-state'
import { Actions } from './components/Actions'
import { AreaControls } from './components/AreaControls'
import { AreaList } from './components/AreaList'
import { SourceControls } from './components/SourceControls'
import { TextControls } from './components/TextControls'
import { TextLayerList } from './components/TextLayerList'
import { CropControls } from './components/CropControls'
import { Segmented } from './components/Segmented'
import { ToolButtons } from './components/ToolButtons'

const RIGHT_TABS: { id: RightTab; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'areas', label: 'Areas' },
]

function tabId(tab: RightTab) {
  return `right-tab-${tab}`
}

function tabPanelId(tab: RightTab) {
  return `right-tabpanel-${tab}`
}

function useImages(model: GenerationModel) {
  const [images, setImages] = useState<string[]>([])
  const [manifestState, setManifestState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    fetch('/assets/manifest.json')
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load image manifest')
        return response.json() as Promise<string[]>
      })
      .then((files) => {
        const availableImages = files.length > 0 ? files : [model.draft.value.image.replace('/assets/', '')]
        setImages(availableImages)
        setManifestState('ready')
        if (!availableImages.includes(model.draft.value.image.replace('/assets/', ''))) {
          model.setField('image', `/assets/${availableImages[0]}`)
        }
      })
      .catch(() => {
        setImages([model.draft.value.image.replace('/assets/', '')])
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
  const tab = editor.tab.value
  const draft = model.draft.value
  const layers = draft.texts
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = Math.min(selectedIndex, layers.length - 1)
  const atCapacity = layers.length >= MAX_TEXT_LAYERS
  const atAreaCapacity = draft.areas.length >= MAX_AREAS
  const textTabRef = useRef<HTMLButtonElement>(null)
  const areasTabRef = useRef<HTMLButtonElement>(null)
  const tabRefs: Record<RightTab, typeof textTabRef> = { text: textTabRef, areas: areasTabRef }

  const selectTab = (next: RightTab, focus = false) => {
    editor.tab.value = next
    if (focus) tabRefs[next].current?.focus()
  }

  const onTabKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const index = RIGHT_TABS.findIndex((entry) => entry.id === tab)
    const step = event.key === 'ArrowRight' ? 1 : -1
    selectTab(RIGHT_TABS[(index + step + RIGHT_TABS.length) % RIGHT_TABS.length].id, true)
  }

  const applyAreasDraw = () => {
    model.setField('draw', 'pixel-sort-areas')
    model.applyGeneration()
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= layers.length) return
    model.moveTextLayer(from, to)
    setSelectedIndex(to)
  }

  const duplicate = (index: number) => {
    if (atCapacity) return
    model.duplicateTextLayer(index)
    setSelectedIndex(index + 1)
  }

  const remove = (index: number) => {
    if (layers.length <= 1) return
    model.removeTextLayer(index)
    setSelectedIndex(index < selected ? selected - 1 : Math.min(selected, layers.length - 2))
  }

  const add = () => {
    if (atCapacity) return
    const source = layers[selected]
    model.addTextLayer({ ...source, text: '', x: source.x + 4, y: source.y + 4 })
    setSelectedIndex(layers.length)
  }

  return <aside className="panel panel-right" onKeyDown={generateOnEnter(model)}>
    <header className="panel-header">
      <div className="tab-bar" role="tablist" aria-label="Right panel" onKeyDown={onTabKeyDown}>
        {RIGHT_TABS.map((entry) => <button
          key={entry.id}
          ref={tabRefs[entry.id]}
          type="button"
          role="tab"
          id={tabId(entry.id)}
          aria-controls={tabPanelId(entry.id)}
          aria-selected={tab === entry.id}
          tabIndex={tab === entry.id ? 0 : -1}
          className={tab === entry.id ? 'tab active' : 'tab'}
          onClick={() => selectTab(entry.id)}
        >{entry.label}</button>)}
      </div>
    </header>
    <div className="panel-scroll">
      <div role="tabpanel" id={tabPanelId('text')} aria-labelledby={tabId('text')} hidden={tab !== 'text'}>
        <section className="panel-section">
          <h2 className="section-title">Layers</h2>
          <TextLayerList
            layers={layers}
            selectedIndex={selected}
            onSelect={setSelectedIndex}
            onMoveUp={(index) => move(index, index - 1)}
            onMoveDown={(index) => move(index, index + 1)}
            onDuplicate={atCapacity ? undefined : duplicate}
            onRemove={layers.length > 1 ? remove : undefined}
          />
          <button type="button" onClick={add} disabled={atCapacity}>Add layer</button>
          {atCapacity && <p className="text-hint">Limit of {MAX_TEXT_LAYERS} layers</p>}
        </section>
        <TextControls
          index={selected}
          layer={layers[selected]}
          onField={(field, value) => model.setTextLayerField(selected, field, value)}
          onMoveUp={selected > 0 ? () => move(selected, selected - 1) : undefined}
          onMoveDown={selected < layers.length - 1 ? () => move(selected, selected + 1) : undefined}
          onDuplicate={atCapacity ? undefined : () => duplicate(selected)}
          onRemove={layers.length > 1 ? () => remove(selected) : undefined}
        />
      </div>
      <div role="tabpanel" id={tabPanelId('areas')} aria-labelledby={tabId('areas')} hidden={tab !== 'areas'}>
        {draft.draw !== 'pixel-sort-areas' && <section className="panel-section">
          <p className="hint-text">Areas only render with the Pixel sorting areas draw.</p>
          <button type="button" onClick={applyAreasDraw}>Use Pixel sorting areas</button>
        </section>}
        <section className="panel-section">
          <Segmented<'layers' | 'union'>
            label="Mode"
            value={draft.areasMode}
            options={[{ value: 'layers', label: 'Layers' }, { value: 'union', label: 'Union' }]}
            onChange={(areasMode) => model.setField('areasMode', areasMode)}
          />
          <p className="hint-text">Layers sorts each area in list order; union sorts once using the topmost area's options.</p>
        </section>
        <AreaList model={model} editor={editor} />
        <AreaControls model={model} editor={editor} />
        <section className="panel-section">
          <h2 className="section-title">Add area</h2>
          <ToolButtons editor={editor} disabled={atAreaCapacity} />
          {atAreaCapacity && <p className="text-hint">Limit of {MAX_AREAS} areas</p>}
        </section>
        <section className="panel-section">
          <label className="checkbox-field">
            <input type="checkbox" checked={editor.maskPreview.value} onChange={(event) => { editor.maskPreview.value = event.currentTarget.checked }} />
            Preview masks
          </label>
        </section>
      </div>
    </div>
  </aside>
}

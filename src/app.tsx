import { useEffect, useState } from 'preact/hooks'
import { MAX_TEXT_LAYERS, type GenerationModel } from './generation-state'
import { Actions } from './components/Actions'
import { SourceControls } from './components/SourceControls'
import { TextControls } from './components/TextControls'
import { TextLayerList } from './components/TextLayerList'
import { CropControls } from './components/CropControls'

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

export function RightPanel({ model }: { model: GenerationModel }) {
  const layers = model.draft.value.texts
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = Math.min(selectedIndex, layers.length - 1)
  const atCapacity = layers.length >= MAX_TEXT_LAYERS

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
    <header className="panel-header"><h1>Text</h1></header>
    <div className="panel-scroll">
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
  </aside>
}

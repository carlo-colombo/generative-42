import { useEffect, useState } from 'preact/hooks'
import type { GenerationModel } from './generation-state'
import { Actions } from './components/Actions'
import { SourceControls } from './components/SourceControls'
import { TextControls } from './components/TextControls'
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
  return <aside className="panel panel-right" onKeyDown={generateOnEnter(model)}>
    <header className="panel-header"><h1>Text</h1></header>
    <div className="panel-scroll">
      <TextControls model={model} layer={1} />
      <TextControls model={model} layer={2} />
    </div>
  </aside>
}

import { useEffect, useState } from 'preact/hooks'
import type { GenerationModel } from './generation-state'
import { Actions } from './components/Actions'
import { SourceControls } from './components/SourceControls'
import { TextControls } from './components/TextControls'

export function App({ model }: { model: GenerationModel }) {
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
  return <aside id="panel" onKeyDown={(event) => {
    if (event.key === 'Enter' && !event.shiftKey && ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) {
      event.preventDefault()
      model.applyGeneration()
    }
  }}>
    <h1>Generative 42</h1>
    {manifestState === 'loading' && <p>Loading images...</p>}
    {manifestState === 'error' && <p>Image manifest unavailable; using the current image.</p>}
    <SourceControls model={model} images={images} />
    <div className="text-controls"><TextControls model={model} layer={1} /><TextControls model={model} layer={2} /></div>
    <Actions model={model} />
  </aside>
}


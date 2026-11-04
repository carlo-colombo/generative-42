import { downloadImage } from '../sketch'
import type { GenerationModel } from '../generation-state'
import { ControlField } from './ControlField'

export function Actions({ model }: { model: GenerationModel }) {
  const generation = model.draft.value
  const download = () => {
    const baseCanvas = document.querySelector<HTMLCanvasElement>('canvas.base-layer')
    if (!baseCanvas) return
    const imageName = generation.image.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'image'
    downloadImage(baseCanvas, `gen-${generation.seed}-${imageName}.png`)
  }
  return <footer className="panel-footer">
    <ControlField label="Seed">
      <div className="seed-row">
        <input aria-label="Seed" type="number" min="1" step="1" value={generation.seed} onInput={(event) => model.setField('seed', Math.max(1, parseInt(event.currentTarget.value, 10) || 1))} />
        <button type="button" onClick={model.nextSeed}>Next</button>
      </div>
    </ControlField>
    <button type="button" className="primary" onClick={() => model.applyGeneration()}>Generate</button>
    <div className="preview-row">
      <label className="checkbox-field">
        <input type="checkbox" checked={model.livePreview.value} onChange={(event) => { model.livePreview.value = event.currentTarget.checked }} />
        Live preview
      </label>
      <button type="button" onClick={model.requestPreview} disabled={model.livePreview.value}>Preview</button>
    </div>
    <button type="button" onClick={download}>Download PNG</button>
  </footer>
}

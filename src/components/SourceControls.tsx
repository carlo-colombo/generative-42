import { DRAWS } from '../draws'
import { ControlField } from './ControlField'
import type { GenerationModel } from '../generation-state'

export function SourceControls({ model, images }: { model: GenerationModel; images: string[] }) {
  const generation = model.draft.value
  return <div className="source-controls">
    <ControlField label="Image">
      <select id="image-select" value={generation.image} onChange={(event) => { model.setField('image', (event.currentTarget as HTMLSelectElement).value); model.applyGeneration() }}>
        {images.map((file) => <option value={`/assets/${file}`}>{file}</option>)}
      </select>
    </ControlField>
    <ControlField label="Draw function">
      <select id="draw-select" value={generation.draw} onChange={(event) => { model.setField('draw', (event.currentTarget as HTMLSelectElement).value); model.applyGeneration() }}>
        {Object.keys(DRAWS).map((name) => <option value={name}>{name}</option>)}
      </select>
    </ControlField>
  </div>
}

import { ControlField } from './ControlField'
import type { GenerationModel } from '../generation-state'

export function SourceControls({ model, images }: { model: GenerationModel; images: string[] }) {
  const generation = model.draft.value
  return <section className="panel-section">
    <h2 className="section-title">Image</h2>
    <ControlField label="Source">
      <select id="image-select" value={generation.image} onChange={(event) => { model.setField('image', (event.currentTarget as HTMLSelectElement).value); model.applyGeneration() }}>
        {images.map((file) => <option value={`/assets/${file}`}>{file}</option>)}
      </select>
    </ControlField>
  </section>
}

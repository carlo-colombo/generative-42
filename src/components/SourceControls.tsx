import { DRAWS } from '../draws'
import { ControlField } from './ControlField'
import type { GenerationModel } from '../generation-state'

export function SourceControls({ model, images }: { model: GenerationModel; images: string[] }) {
  const generation = model.draft.value
  const controls = DRAWS[generation.draw]?.controls ?? []
  return <>
    <section className="panel-section">
      <h2 className="section-title">Image</h2>
      <ControlField label="Source">
        <select id="image-select" value={generation.image} onChange={(event) => { model.setField('image', (event.currentTarget as HTMLSelectElement).value); model.applyGeneration() }}>
          {images.map((file) => <option value={`/assets/${file}`}>{file}</option>)}
        </select>
      </ControlField>
    </section>
    <section className="panel-section">
      <h2 className="section-title">Effects</h2>
      <ControlField label="Draw function">
        <select id="draw-select" value={generation.draw} onChange={(event) => { model.setField('draw', (event.currentTarget as HTMLSelectElement).value); model.applyGeneration() }}>
          {Object.keys(DRAWS).map((name) => <option value={name}>{DRAWS[name].label ?? name}</option>)}
        </select>
      </ControlField>
      {controls.length > 0 && <div className="field-grid">
        {controls.map((control) => control.type === 'select'
          ? <ControlField label={control.label}>
            <select value={generation[control.field]} onChange={(event) => model.setField(control.field, event.currentTarget.value as typeof generation[typeof control.field])}>
              {control.options.map((option) => <option value={option.value}>{option.label}</option>)}
            </select>
          </ControlField>
          : <ControlField label={control.label} value={generation[control.field]}>
            <input
              type="range"
              min={control.min}
              max={control.max}
              step={control.step}
              value={generation[control.field]}
              onChange={(event) => {
                const value = Number((event.currentTarget as HTMLInputElement).value)
                const nextGeneration = { ...model.draft.value, [control.field]: value }
                model.setField(control.field, value)
                model.applyGeneration(nextGeneration)
              }}
            />
          </ControlField>)}
      </div>}
    </section>
  </>
}

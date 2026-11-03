import type { EditorModel } from '../editor-state'
import { updateArea } from '../editor-state'
import type { GenerationModel } from '../generation-state'
import type { EdgeMode, SortArea } from '../types'
import { ControlField } from './ControlField'
import { Segmented } from './Segmented'

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value
}

function SliderField({ label, value, min, max, step, unit, disabled, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const apply = (raw: number) => {
    if (!Number.isFinite(raw)) return
    onChange(clamp(Math.round(raw / step) * step, min, max))
  }
  return <ControlField label={label} value={`${value}${unit ?? ''}`}>
    <div className="slider-row">
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onInput={(event) => apply(Number(event.currentTarget.value))} />
      <input className="slider-input" type="number" min={min} max={max} step={step} value={value} disabled={disabled} onInput={(event) => apply(Number(event.currentTarget.value))} />
    </div>
  </ControlField>
}

export function AreaControls({ model, editor }: { model: GenerationModel; editor: EditorModel }) {
  const area = model.draft.value.areas.find((candidate) => candidate.id === editor.selectedId.value)
  if (!area) {
    return <section className="panel-section">
      <h2 className="section-title">Area</h2>
      <p className="hint-text">Select an area on the stage or in the list to edit it.</p>
    </section>
  }

  const canvas = editor.canvasSize.value
  const minSide = Math.min(canvas.width, canvas.height) || 0
  const featherPixels = Math.round((area.edge.feather / 100) * minSide)
  const update = (change: (current: SortArea) => SortArea) => updateArea(model, area.id, change)
  const gradientDirection = area.sort.direction === 'horizontal'
    ? area.sort.reverse ? 'to left' : 'to right'
    : area.sort.reverse ? 'to top' : 'to bottom'

  return <section className="panel-section">
    <h2 className="section-title">Area</h2>
    <p className="hint-text">{area.shape.kind} · {area.id}</p>

    <ControlField label="Label">
      <input type="text" value={area.label} onInput={(event) => {
        const label = event.currentTarget.value.toUpperCase()
        update((current) => ({ ...current, label }))
      }} />
    </ControlField>

    <ControlField label="Colour" value={area.color}>
      <div className="color-row">
        <input type="color" value={area.color} onInput={(event) => {
          const color = event.currentTarget.value
          update((current) => ({ ...current, color }))
        }} />
        <label className="checkbox-field">
          <input type="checkbox" checked={area.visible} onChange={(event) => {
            const visible = event.currentTarget.checked
            update((current) => ({ ...current, visible }))
          }} />
          Visible
        </label>
      </div>
    </ControlField>

    <ControlField label="Direction">
      <div className="direction-row">
        <div className="segmented" role="group" aria-label="Direction">
          <button type="button" aria-label="Horizontal sort" aria-pressed={area.sort.direction === 'horizontal'} className={area.sort.direction === 'horizontal' ? 'active' : undefined} title="Horizontal" onClick={() => update((current) => ({ ...current, sort: { ...current.sort, direction: 'horizontal' } }))}>↔</button>
          <button type="button" aria-label="Vertical sort" aria-pressed={area.sort.direction === 'vertical'} className={area.sort.direction === 'vertical' ? 'active' : undefined} title="Vertical" onClick={() => update((current) => ({ ...current, sort: { ...current.sort, direction: 'vertical' } }))}>↕</button>
        </div>
        <button
          type="button"
          className={area.sort.reverse ? 'toggle-button active' : 'toggle-button'}
          aria-label="Reverse sort direction"
          aria-pressed={area.sort.reverse}
          onClick={() => update((current) => ({ ...current, sort: { ...current.sort, reverse: !current.sort.reverse } }))}
        >
          ⇄ Reverse
        </button>
      </div>
    </ControlField>

    <SliderField label="Amount" value={area.sort.amount} min={0} max={100} step={1} unit="%" onChange={(amount) => update((current) => ({ ...current, sort: { ...current.sort, amount } }))} />
    <SliderField label="Opacity" value={area.opacity} min={0} max={100} step={1} unit="%" onChange={(opacity) => update((current) => ({ ...current, opacity }))} />

    <Segmented<EdgeMode>
      label="Edge"
      value={area.edge.mode}
      options={[{ value: 'blend', label: 'Blend' }, { value: 'ragged', label: 'Ragged' }]}
      onChange={(mode) => update((current) => ({ ...current, edge: { ...current.edge, mode } }))}
    />

    <ControlField label="Feather" value={area.edge.mode === 'ragged' ? 'blend only' : `${area.edge.feather}% · ${featherPixels}px`}>
      <div className="slider-row">
        <input type="range" min={0} max={100} step={1} value={area.edge.feather} onInput={(event) => {
          const feather = clamp(Number(event.currentTarget.value), 0, 100)
          update((current) => ({ ...current, edge: { ...current.edge, feather } }))
        }} />
        <input className="slider-input" type="number" min={0} max={100} step={1} value={area.edge.feather} onInput={(event) => {
          const feather = Number(event.currentTarget.value)
          if (!Number.isFinite(feather)) return
          update((current) => ({ ...current, edge: { ...current.edge, feather: clamp(feather, 0, 100) } }))
        }} />
      </div>
      <span className="feather-swatch" style={{ background: `linear-gradient(${gradientDirection}, transparent, ${area.color})` }} />
    </ControlField>

    <SliderField
      label="Jitter"
      value={area.edge.jitter}
      min={0}
      max={100}
      step={1}
      unit="%"
      disabled={area.edge.mode !== 'ragged'}
      onChange={(jitter) => update((current) => ({ ...current, edge: { ...current.edge, jitter } }))}
    />
    {area.edge.mode !== 'ragged' && <p className="hint-text">Jitter applies to ragged edges only.</p>}
    {area.edge.mode === 'ragged' && <p className="hint-text">Feather applies to blend edges only.</p>}
    <p className="hint-text">Feather and jitter are percentages of the shorter canvas side{minSide > 0 ? ` (${minSide}px)` : ''}.</p>

    {area.shape.kind === 'path' && !area.shape.closed && <Segmented<'a' | 'b'>
      label="Open side"
      value={area.shape.side}
      options={[{ value: 'a', label: 'A · left' }, { value: 'b', label: 'B · right' }]}
      onChange={(side) => update((current) => current.shape.kind === 'path' ? { ...current, shape: { ...current.shape, side } } : current)}
    />}
  </section>
}

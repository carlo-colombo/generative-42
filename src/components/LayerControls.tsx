import { useRef, useState } from 'preact/hooks'
import { DEFAULT_FONT, FONTS } from '../fonts'
import { EFFECTS, EFFECT_LIST, type EffectControl } from '../effects'
import {
  setEffect,
  updateEffectLayer,
  updateEffectParams,
  updateTextLayerField,
  type TextField,
  type EditorModel,
} from '../editor-state'
import type { GenerationModel } from '../generation-state'
import { clampCutLimit, CUT_LIMIT_DEFAULT, CUT_LIMIT_MAX, CUT_LIMIT_MIN, cutTextAtWords } from '../text-cut'
import type { EffectId, EffectLayer, EffectParams, TextLayer } from '../types'
import { ControlField } from './ControlField'
import { HelpPopover } from './HelpPopover'
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
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onInput={(event) => apply(Number(event.currentTarget.value))} />
      <input aria-label={label} className="slider-input" type="number" min={min} max={max} step={step} value={value} disabled={disabled} onInput={(event) => apply(Number(event.currentTarget.value))} />
    </div>
  </ControlField>
}

function EffectParamControl({ control, params, onChange }: {
  control: EffectControl
  params: EffectParams
  onChange: (key: keyof EffectParams, value: number | string | boolean) => void
}) {
  if (control.type === 'range') {
    return <SliderField
      label={control.label}
      value={Number(params[control.key] ?? control.fallback ?? 0)}
      min={control.min}
      max={control.max}
      step={control.step}
      onChange={(value) => onChange(control.key, value)}
    />
  }
  if (control.type === 'select') {
    return <ControlField label={control.label}>
      <select aria-label={control.label} value={String(params[control.key])} onChange={(event) => onChange(control.key, event.currentTarget.value)}>
        {control.options.map((option) => <option value={option.value}>{option.label}</option>)}
      </select>
    </ControlField>
  }
  return <button
    type="button"
    className={params[control.key] ? 'toggle-button active' : 'toggle-button'}
    aria-pressed={Boolean(params[control.key])}
    onClick={() => onChange(control.key, !params[control.key])}
  >
    {control.label}
  </button>
}

function EffectInspector({ model, editor, layer }: { model: GenerationModel; editor: EditorModel; layer: EffectLayer }) {
  const definition = EFFECTS[layer.effect]
  const canvas = editor.canvasSize.value
  const minSide = Math.min(canvas.width, canvas.height) || 0
  const featherPixels = Math.round((layer.edge.feather / 100) * minSide)
  const direction = layer.effect === 'pixel-sort'
    ? layer.params.direction === 'horizontal'
      ? layer.params.reverse ? 'to left' : 'to right'
      : layer.params.reverse ? 'to top' : 'to bottom'
    : 'to bottom'
  const update = (change: (current: EffectLayer) => EffectLayer) => updateEffectLayer(model, layer.id, change)

  return <section className="panel-section">
    <div className="section-heading">
      <h2 className="section-title">Effect layer</h2>
      <HelpPopover label="How effect layers compose">
        <dl className="help-list">
          <dt>Stack</dt>
          <dd>Each visible layer renders over the composite below it, bottom to top; the cropped source is the background. Later layers therefore sample the result of earlier effects.</dd>
          <dt>Effect</dt>
          <dd>The effect paints inside the layer shape. Pixel sort reads the composite below and sorts it; the other effects draw over that composite.</dd>
          <dt>Direction</dt>
          <dd>Pixel sort reads every row left to right, or every column top to bottom. Runs are cut wherever the mask is empty.</dd>
          <dt>Reverse</dt>
          <dd>Which end of a run is read first. The sorted block moves from the start of the run to its end.</dd>
          <dt>Randomness</dt>
          <dd>How far each run's sorted block starts in from the border, drawn at random up to that share of the run. At 0 the whole run is sorted, so the layer border stays sharp.</dd>
          <dt>Feather</dt>
          <dd>Width of the soft ramp measured inward from the whole shape border, as a share of the shorter canvas side. Near the border the layer result fades back into the artwork.</dd>
          <dt>Blend</dt>
          <dd>Cross-fades the layer result with that feather ramp. Soft edges, no offset.</dd>
          <dt>Ragged</dt>
          <dd>Writes the layer result hard, so the border stays crisp, and instead pushes each pixel-sort run away from the border by a random amount. Feather has no effect here.</dd>
          <dt>Jitter</dt>
          <dd>How far a pixel-sort run may be pushed, up to that share of the shorter canvas side, in either direction. Only used by ragged.</dd>
          <dt>Opacity</dt>
          <dd>How much of this layer's whole result is mixed over the layers below it.</dd>
        </dl>
      </HelpPopover>
    </div>
    <p className="hint-text">{layer.shape.kind} · {layer.id}</p>

    <ControlField label="Effect">
      <select aria-label="Effect" value={layer.effect} onChange={(event) => setEffect(model, layer.id, event.currentTarget.value as EffectId)}>
        {EFFECT_LIST.map((entry) => <option value={entry.id}>{entry.label}</option>)}
      </select>
    </ControlField>

    {definition.controls.map((control) => <EffectParamControl
      key={control.key}
      control={control}
      params={layer.params}
      onChange={(key, value) => updateEffectParams(model, layer.id, key, value)}
    />)}
    {layer.effect === 'curtain-grid' && <p className="hint-text">0% top/left · 50% balanced · 100% bottom/right</p>}
    {layer.effect === 'rotate' && <p className="hint-text">0% no shift · 100% half a turn; pixels wrap at the area edge</p>}

    <ControlField label="Label">
      <input aria-label="Label" type="text" value={layer.label} onInput={(event) => {
        const label = event.currentTarget.value.toUpperCase()
        update((current) => ({ ...current, label }))
      }} />
    </ControlField>

    <ControlField label="Colour" value={layer.color}>
      <div className="color-row">
        <input aria-label="Colour" type="color" value={layer.color} onInput={(event) => {
          const color = event.currentTarget.value
          update((current) => ({ ...current, color }))
        }} />
        <label className="checkbox-field">
          <input type="checkbox" checked={layer.visible} onChange={(event) => {
            const visible = event.currentTarget.checked
            update((current) => ({ ...current, visible }))
          }} />
          Visible
        </label>
      </div>
    </ControlField>

    <SliderField label="Opacity" value={layer.opacity} min={0} max={100} step={1} unit="%" onChange={(opacity) => update((current) => ({ ...current, opacity }))} />

    <Segmented
      label="Edge"
      value={layer.edge.mode}
      options={[{ value: 'blend', label: 'Blend' }, { value: 'ragged', label: 'Ragged' }]}
      onChange={(mode) => update((current) => ({ ...current, edge: { ...current.edge, mode } }))}
    />
    <p className="hint-text">{layer.edge.mode === 'ragged'
      ? 'Hard pixels, run starts pushed by the jitter.'
      : 'Layer result cross-faded along the feather ramp.'}</p>

    <ControlField label="Feather" value={layer.edge.mode === 'ragged' ? 'blend only' : `${layer.edge.feather}% · ${featherPixels}px`}>
      <div className="slider-row">
        <input aria-label="Feather" type="range" min={0} max={100} step={1} value={layer.edge.feather} onInput={(event) => {
          const feather = clamp(Number(event.currentTarget.value), 0, 100)
          update((current) => ({ ...current, edge: { ...current.edge, feather } }))
        }} />
        <input aria-label="Feather" className="slider-input" type="number" min={0} max={100} step={1} value={layer.edge.feather} onInput={(event) => {
          const feather = Number(event.currentTarget.value)
          if (!Number.isFinite(feather)) return
          update((current) => ({ ...current, edge: { ...current.edge, feather: clamp(feather, 0, 100) } }))
        }} />
      </div>
      <span className="feather-swatch" style={{ background: `linear-gradient(${direction}, transparent, ${layer.color})` }} />
    </ControlField>

    <SliderField
      label="Jitter"
      value={layer.edge.jitter}
      min={0}
      max={100}
      step={1}
      unit="%"
      disabled={layer.edge.mode !== 'ragged'}
      onChange={(jitter) => update((current) => ({ ...current, edge: { ...current.edge, jitter } }))}
    />
    {layer.edge.mode !== 'ragged' && <p className="hint-text">Jitter applies to ragged edges only.</p>}
    {layer.edge.mode === 'ragged' && <p className="hint-text">Feather applies to blend edges only.</p>}
    {layer.edge.mode !== 'ragged' && featherPixels > 0 && <p className="hint-text">Fades in from the whole border, {featherPixels}px inward.</p>}
    <p className="hint-text">Feather and jitter are percentages of the shorter canvas side{minSide > 0 ? ` (${minSide}px)` : ''}.</p>

    {layer.shape.kind === 'path' && !layer.shape.closed && <Segmented<'a' | 'b'>
      label="Open side"
      value={layer.shape.side}
      options={[{ value: 'a', label: 'A · left' }, { value: 'b', label: 'B · right' }]}
      onChange={(side) => update((current) => current.shape.kind === 'path' ? { ...current, shape: { ...current.shape, side } } : current)}
    />}
  </section>
}

const alignments = ['left', 'center', 'right'] as const
const verticalAlignments = ['top', 'center', 'bottom'] as const

function TextInspector({ model, layer }: { model: GenerationModel; layer: TextLayer }) {
  const field = (name: TextField) => (value: string) => updateTextLayerField(model, layer.id, name, value)
  const cuts = useRef<Map<string, { source: string; result: string }>>(new Map())
  const [cutLimit, setCutLimit] = useState(CUT_LIMIT_DEFAULT)
  const cut = cuts.current.get(layer.id)

  const cutText = () => {
    const source = cut && layer.text === cut.result ? cut.source : layer.text
    const result = cutTextAtWords(source, cutLimit).toUpperCase()
    cuts.current.set(layer.id, { source, result })
    updateTextLayerField(model, layer.id, 'text', result)
  }

  const resetText = () => {
    if (!cut) return
    cuts.current.delete(layer.id)
    updateTextLayerField(model, layer.id, 'text', cut.source)
  }

  return <section className="panel-section">
    <div className="section-heading">
      <h2 className="section-title">Text layer</h2>
      <HelpPopover label="How text layers compose">
        <p>Text layers sit in the same stack as effects and are baked into the exported composition; the <b>seed=</b> label stays on its own overlay. Text layers are positioned on the full canvas and are not editable on the stage.</p>
      </HelpPopover>
    </div>
    <p className="hint-text">text · {layer.id}</p>
    <ControlField label="Content">
      <textarea aria-label="Content" rows={3} value={layer.text} onInput={(event) => field('text')(event.currentTarget.value)} />
    </ControlField>
    <ControlField label="Cut at (chars)">
      <input aria-label="Cut at (chars)" type="number" min={CUT_LIMIT_MIN} max={CUT_LIMIT_MAX} step="1" value={cutLimit} onInput={(event) => {
        const raw = Number(event.currentTarget.value)
        if (event.currentTarget.value.trim() === '' || !Number.isFinite(raw)) return
        setCutLimit(clampCutLimit(raw))
      }} />
    </ControlField>
    <div className="cut-row">
      <button type="button" onClick={cutText} disabled={layer.text.trim() === ''}>Cut text</button>
      {cut && <button type="button" onClick={resetText}>Reset</button>}
    </div>
    <p className="hint-text">Cutting breaks lines at word boundaries from the original text; pressing it again re-cuts from that original, and a word longer than the limit is split.</p>
    <ControlField label="Font">
      <select aria-label="Font" id="text-font" value={FONTS.some((font) => font.path === layer.font) ? layer.font : DEFAULT_FONT} onChange={(event) => field('font')(event.currentTarget.value)}>
        {FONTS.map((font) => <option value={font.path}>{font.label}</option>)}
      </select>
    </ControlField>
    <div className="field-grid">
      <ControlField label="Size">
        <input aria-label="Size" type="number" min="10" max="3000" step="5" value={layer.size} onInput={(event) => field('size')(event.currentTarget.value)} />
      </ControlField>
      <ControlField label="Opacity" value={`${layer.opacity}%`}>
        <input aria-label="Opacity" type="range" min="0" max="100" value={layer.opacity} onInput={(event) => field('opacity')(event.currentTarget.value)} />
      </ControlField>
      <ControlField label="Align">
        <select aria-label="Align" value={layer.align} onChange={(event) => field('align')(event.currentTarget.value)}>
          {alignments.map((value) => <option value={value}>{value}</option>)}
        </select>
      </ControlField>
      <ControlField label="Vertical">
        <select aria-label="Vertical align" value={layer.vAlign} onChange={(event) => field('vAlign')(event.currentTarget.value)}>
          {verticalAlignments.map((value) => <option value={value}>{value}</option>)}
        </select>
      </ControlField>
      <ControlField label="X (%)">
        <input aria-label="X (%)" type="number" min="0" max="100" value={layer.x} onInput={(event) => field('x')(event.currentTarget.value)} />
      </ControlField>
      <ControlField label="Y (%)">
        <input aria-label="Y (%)" type="number" min="0" max="100" value={layer.y} onInput={(event) => field('y')(event.currentTarget.value)} />
      </ControlField>
    </div>
  </section>
}

export function LayerControls({ model, editor }: { model: GenerationModel; editor: EditorModel }) {
  const layer = model.draft.value.layers.find((candidate) => candidate.id === editor.selectedLayerId.value)
  if (!layer) {
    return <section className="panel-section">
      <h2 className="section-title">Layer</h2>
      <p className="hint-text">Select a layer in the list to edit it.</p>
    </section>
  }
  return layer.kind === 'effect'
    ? <EffectInspector model={model} editor={editor} layer={layer} />
    : <TextInspector model={model} layer={layer} />
}

import { FONTS, DEFAULT_FONT } from '../fonts'
import type { GenerationModel, TextLayerField } from '../generation-state'
import { ControlField } from './ControlField'

type TextLayerNumber = 1 | 2

const alignments = ['left', 'center', 'right'] as const
const verticalAlignments = ['top', 'center', 'bottom'] as const

export function TextControls({ model, layer }: { model: GenerationModel; layer: TextLayerNumber }) {
  const textLayer = model.getTextLayer(layer)
  const update = (field: TextLayerField, value: string) => {
    model.setTextLayerField(layer, field, value)
  }

  return (
    <section className="panel-section text-control-group">
      <h2 className="section-title">Text {layer}</h2>
      <ControlField label="Content">
        <textarea rows={3} value={textLayer.text} onInput={(event) => update('text', event.currentTarget.value)} />
      </ControlField>
      <ControlField label="Font">
        <select id={`${layer === 1 ? 'text' : 'text2'}-font`} value={FONTS.some((font) => font.path === textLayer.font) ? textLayer.font : DEFAULT_FONT} onChange={(event) => update('font', event.currentTarget.value)}>
          {FONTS.map((font) => <option value={font.path}>{font.label}</option>)}
        </select>
      </ControlField>
      <div className="field-grid">
        <ControlField label="Size">
          <input type="number" min="10" max="3000" step="5" value={textLayer.size} onInput={(event) => update('size', event.currentTarget.value)} />
        </ControlField>
        <ControlField label="Opacity" value={`${textLayer.opacity}%`}>
          <input type="range" min="0" max="100" value={textLayer.opacity} onInput={(event) => update('opacity', event.currentTarget.value)} />
        </ControlField>
        <ControlField label="Align">
          <select value={textLayer.align} onChange={(event) => update('align', event.currentTarget.value)}>
            {alignments.map((value) => <option value={value}>{value}</option>)}
          </select>
        </ControlField>
        <ControlField label="Vertical">
          <select value={textLayer.vAlign} onChange={(event) => update('vAlign', event.currentTarget.value)}>
            {verticalAlignments.map((value) => <option value={value}>{value}</option>)}
          </select>
        </ControlField>
        <ControlField label="X (%)">
          <input type="number" min="0" max="100" value={textLayer.x} onInput={(event) => update('x', event.currentTarget.value)} />
        </ControlField>
        <ControlField label="Y (%)">
          <input type="number" min="0" max="100" value={textLayer.y} onInput={(event) => update('y', event.currentTarget.value)} />
        </ControlField>
      </div>
    </section>
  )
}

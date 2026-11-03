import { FONTS, DEFAULT_FONT } from '../fonts'
import type { TextLayerField } from '../generation-state'
import type { TextLayer } from '../types'
import { ControlField } from './ControlField'
import { TextLayerActions } from './TextLayerActions'

type TextControlsProps = {
  index: number
  layer: TextLayer
  onField: (field: TextLayerField, value: string) => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDuplicate?: () => void
  onRemove?: () => void
}

const alignments = ['left', 'center', 'right'] as const
const verticalAlignments = ['top', 'center', 'bottom'] as const

export function TextControls({ index, layer, onField, onMoveUp, onMoveDown, onDuplicate, onRemove }: TextControlsProps) {
  return (
    <section className="panel-section text-control-group">
      <div className="section-heading">
        <h2 className="section-title">Text {index + 1}</h2>
        <TextLayerActions index={index} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onDuplicate={onDuplicate} onRemove={onRemove} />
      </div>
      <ControlField label="Content">
        <textarea rows={3} value={layer.text} onInput={(event) => onField('text', event.currentTarget.value)} />
      </ControlField>
      <ControlField label="Font">
        <select id="text-font" value={FONTS.some((font) => font.path === layer.font) ? layer.font : DEFAULT_FONT} onChange={(event) => onField('font', event.currentTarget.value)}>
          {FONTS.map((font) => <option value={font.path}>{font.label}</option>)}
        </select>
      </ControlField>
      <div className="field-grid">
        <ControlField label="Size">
          <input type="number" min="10" max="3000" step="5" value={layer.size} onInput={(event) => onField('size', event.currentTarget.value)} />
        </ControlField>
        <ControlField label="Opacity" value={`${layer.opacity}%`}>
          <input type="range" min="0" max="100" value={layer.opacity} onInput={(event) => onField('opacity', event.currentTarget.value)} />
        </ControlField>
        <ControlField label="Align">
          <select value={layer.align} onChange={(event) => onField('align', event.currentTarget.value)}>
            {alignments.map((value) => <option value={value}>{value}</option>)}
          </select>
        </ControlField>
        <ControlField label="Vertical">
          <select value={layer.vAlign} onChange={(event) => onField('vAlign', event.currentTarget.value)}>
            {verticalAlignments.map((value) => <option value={value}>{value}</option>)}
          </select>
        </ControlField>
        <ControlField label="X (%)">
          <input type="number" min="0" max="100" value={layer.x} onInput={(event) => onField('x', event.currentTarget.value)} />
        </ControlField>
        <ControlField label="Y (%)">
          <input type="number" min="0" max="100" value={layer.y} onInput={(event) => onField('y', event.currentTarget.value)} />
        </ControlField>
      </div>
    </section>
  )
}

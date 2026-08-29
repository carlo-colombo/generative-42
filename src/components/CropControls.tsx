import { getCropRect } from '../crop'
import { useState } from 'preact/hooks'
import type { GenerationModel } from '../generation-state'
import type { CropFormat } from '../types'
import { ControlField } from './ControlField'

const formats: { value: CropFormat; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'square', label: 'Square 1:1' },
  { value: 'portrait', label: 'Portrait 4:5' },
  { value: 'landscape', label: 'Landscape 4:3' },
  { value: 'wide', label: 'Wide 16:9' },
]

export function CropControls({ model }: { model: GenerationModel }) {
  const generation = model.draft.value
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 })
  const [dragging, setDragging] = useState(false)
  const rect = getCropRect(imageSize.width, imageSize.height, generation)
  const left = (rect.x / imageSize.width) * 100
  const top = (rect.y / imageSize.height) * 100
  const width = (rect.width / imageSize.width) * 100
  const height = (rect.height / imageSize.height) * 100

  const moveCrop = (event: PointerEvent) => {
    if (!dragging) return
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
    model.setField('cropX', Math.round(Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100))))
    model.setField('cropY', Math.round(Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100))))
  }

  return <section className="crop-controls">
    <h2>Crop</h2>
    <div
      className="crop-preview"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        moveCrop(event)
      }}
      onPointerMove={moveCrop}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      <img key={generation.image} src={generation.image} alt="Source crop preview" onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
      {generation.cropPreview && <div className="crop-rect" style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }} />}
    </div>
    <ControlField label="Format">
      <select value={generation.cropFormat} onChange={(event) => model.setField('cropFormat', event.currentTarget.value as CropFormat)}>
        {formats.map((format) => <option value={format.value}>{format.label}</option>)}
      </select>
    </ControlField>
    <ControlField label={`Size: ${generation.cropSize}%`}>
      <input type="range" min="1" max="100" value={generation.cropSize} onInput={(event) => model.setField('cropSize', Number(event.currentTarget.value))} />
    </ControlField>
    <ControlField label={`Horizontal position: ${generation.cropX}%`}>
      <input type="range" min="0" max="100" value={generation.cropX} onInput={(event) => model.setField('cropX', Number(event.currentTarget.value))} />
    </ControlField>
    <ControlField label={`Vertical position: ${generation.cropY}%`}>
      <input type="range" min="0" max="100" value={generation.cropY} onInput={(event) => model.setField('cropY', Number(event.currentTarget.value))} />
    </ControlField>
    <label className="checkbox-field">
      <input type="checkbox" checked={generation.cropPreview} onChange={(event) => model.setField('cropPreview', event.currentTarget.checked)} />
      Show crop preview
    </label>
  </section>
}

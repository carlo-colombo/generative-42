import { getCropRect } from '../crop'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { GenerationModel } from '../generation-state'
import type { CropFormat } from '../types'
import { useImageSource } from '../uploads'
import { ControlField } from './ControlField'

const PREVIEW_MAX_HEIGHT = 150

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
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const source = useImageSource(generation.image)
  const rect = getCropRect(imageSize.width, imageSize.height, generation)
  const left = (rect.x / imageSize.width) * 100
  const top = (rect.y / imageSize.height) * 100
  const width = (rect.width / imageSize.width) * 100
  const height = (rect.height / imageSize.height) * 100

  useEffect(() => {
    const frame = previewRef.current
    const section = frame?.parentElement
    if (!frame || !section) return
    const fit = () => {
      const available = section.clientWidth
      if (available <= 0) return
      const aspect = imageSize.width / imageSize.height
      const height = Math.min(PREVIEW_MAX_HEIGHT, available / aspect)
      setPreviewSize({ width: Math.round(height * aspect), height: Math.round(height) })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(section)
    return () => observer.disconnect()
  }, [imageSize])

  const moveCrop = (event: PointerEvent) => {
    if (!dragging) return
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
    model.setField('cropX', Math.round(Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100))))
    model.setField('cropY', Math.round(Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100))))
  }

  return <section className="panel-section">
    <h2 className="section-title">Selection</h2>
    <div
      className="crop-preview"
      ref={previewRef}
      style={previewSize.width > 0 ? { width: `${previewSize.width}px`, height: `${previewSize.height}px` } : undefined}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        moveCrop(event)
      }}
      onPointerMove={moveCrop}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      {source && <img key={source} src={source} alt="Source crop preview" onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />}
      {generation.cropPreview && <div className="crop-rect" style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }} />}
    </div>
    <div className="field-grid">
      <ControlField label="Format">
        <select aria-label="Crop format" value={generation.cropFormat} onChange={(event) => model.setField('cropFormat', event.currentTarget.value as CropFormat)}>
          {formats.map((format) => <option value={format.value}>{format.label}</option>)}
        </select>
      </ControlField>
      <ControlField label="Size" value={`${generation.cropSize}%`}>
        <input aria-label="Crop size (%)" type="range" min="1" max="100" value={generation.cropSize} onInput={(event) => model.setField('cropSize', Number(event.currentTarget.value))} />
      </ControlField>
      <ControlField label="X (%)" value={generation.cropX}>
        <input aria-label="Crop X (%)" type="range" min="0" max="100" value={generation.cropX} onInput={(event) => model.setField('cropX', Number(event.currentTarget.value))} />
      </ControlField>
      <ControlField label="Y (%)" value={generation.cropY}>
        <input aria-label="Crop Y (%)" type="range" min="0" max="100" value={generation.cropY} onInput={(event) => model.setField('cropY', Number(event.currentTarget.value))} />
      </ControlField>
    </div>
    <label className="checkbox-field">
      <input type="checkbox" checked={generation.cropPreview} onChange={(event) => model.setField('cropPreview', event.currentTarget.checked)} />
      Show crop preview
    </label>
  </section>
}

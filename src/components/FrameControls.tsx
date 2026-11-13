import { useEffect, useState } from 'preact/hooks'
import { getCropRect } from '../crop'
import { frameLayout, frameSurfaceIncrease, MAX_FRAME_GROWTH, MAX_FRAME_RATIO } from '../frame'
import type { GenerationModel } from '../generation-state'
import { useImageSource } from '../uploads'
import { ControlField } from './ControlField'

function clampSide(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(MAX_FRAME_RATIO, Math.round(value)))
}

function clampGrowth(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_FRAME_GROWTH, Math.round(value)))
}

export function FrameControls({ model }: { model: GenerationModel }) {
  const generation = model.draft.value
  const source = useImageSource(generation.image)
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    setImageSize(null)
    if (!source) return
    let active = true
    const image = new Image()
    image.onload = () => {
      if (active) setImageSize({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.src = source
    return () => {
      active = false
    }
  }, [source])

  const crop = imageSize ? getCropRect(imageSize.width, imageSize.height, generation) : null
  const cropped = crop
    ? { width: Math.max(1, Math.round(crop.width)), height: Math.max(1, Math.round(crop.height)) }
    : null
  const framed = cropped ? frameLayout(cropped.width, cropped.height, generation) ?? cropped : null
  const increase = cropped && framed ? frameSurfaceIncrease(cropped.width, cropped.height, framed) : 0

  return <section className="panel-section">
    <h2 className="section-title">Frame</h2>
    <label className="checkbox-field">
      <input type="checkbox" checked={generation.frameOn} onChange={(event) => model.setField('frameOn', event.currentTarget.checked)} />
      Add frame
    </label>
    <ControlField label="Colour" value={generation.frameColor}>
      <div className="color-row">
        <input aria-label="Frame colour" type="color" value={generation.frameColor} onInput={(event) => model.setField('frameColor', event.currentTarget.value)} />
      </div>
    </ControlField>
    <ControlField label="Ratio">
      <div className="ratio-row">
        <input aria-label="Frame ratio width" type="number" min="1" max={MAX_FRAME_RATIO} value={generation.frameRatioW} onInput={(event) => model.setField('frameRatioW', clampSide(Number(event.currentTarget.value)))} />
        <span className="ratio-separator">:</span>
        <input aria-label="Frame ratio height" type="number" min="1" max={MAX_FRAME_RATIO} value={generation.frameRatioH} onInput={(event) => model.setField('frameRatioH', clampSide(Number(event.currentTarget.value)))} />
      </div>
    </ControlField>
    <ControlField label="Growth" value={`${generation.frameGrowth}%`}>
      <div className="slider-row">
        <input aria-label="Frame growth (%)" type="range" min="0" max={MAX_FRAME_GROWTH} value={generation.frameGrowth} onInput={(event) => model.setField('frameGrowth', clampGrowth(Number(event.currentTarget.value)))} />
        <input aria-label="Frame growth number (%)" className="slider-input" type="number" min="0" max={MAX_FRAME_GROWTH} value={generation.frameGrowth} onInput={(event) => model.setField('frameGrowth', clampGrowth(Number(event.currentTarget.value)))} />
      </div>
    </ControlField>
    <p className="hint-text" data-frame-dims>
      {framed ? `${framed.width} x ${framed.height} · +${increase}% surface` : 'Upload an image to see the framed size.'}
    </p>
    <p className="hint-text">Padding only: the image is never cropped, rescaled, or stretched.</p>
  </section>
}

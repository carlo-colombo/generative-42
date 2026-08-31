import { downloadImage } from '../sketch'
import type { GenerationModel } from '../generation-state'

export function Actions({ model }: { model: GenerationModel }) {
  const generation = model.draft.value
  const download = () => {
    const baseCanvas = document.querySelector<HTMLCanvasElement>('canvas.base-layer')
    const textCanvas = document.querySelector<HTMLCanvasElement>('canvas.text-layer')
    if (!baseCanvas || !textCanvas) return
    const imageName = generation.image.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'image'
    downloadImage(baseCanvas, textCanvas, `gen-${generation.seed}-${generation.draw}-${imageName}.png`)
  }
  return <div className="actions">
    <div className="seed-row"><span>Seed: {generation.seed}</span><button type="button" onClick={model.nextSeed}>Next seed</button></div>
    <button type="button" className="primary" onClick={() => model.applyGeneration()}>Generate</button>
    <button type="button" onClick={download}>Download PNG</button>
  </div>
}

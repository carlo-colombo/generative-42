import p5 from 'p5'
import { render } from 'preact'
import { App } from './app'
import { createSketch } from './sketch'
import { createGenerationModel, getGeneration } from './generation-state'
import type { Generation } from './types'
import './style.css'

const generation = getGeneration()
const model = createGenerationModel(generation)
const app = document.getElementById('app')!
let textCanvas: HTMLCanvasElement | undefined
let renderText: ((generation: Generation) => void) | undefined
const unsubscribeDraft = model.subscribeDraft((nextGeneration) => {
  renderText?.(nextGeneration)
})
const instance = new p5(createSketch(generation, (base, text, renderLayer) => {
  base.classList.add('base-layer')
  textCanvas = text
  renderText = renderLayer
  app.appendChild(text)
  renderLayer(model.draft.value)
}), app)

const panel = document.createElement('div')
panel.className = 'panel-root'
document.body.insertBefore(panel, app)
render(<App model={model} />, panel)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    instance.remove()
    unsubscribeDraft()
    textCanvas?.remove()
  })
}

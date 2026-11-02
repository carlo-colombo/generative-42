import p5 from 'p5'
import { render } from 'preact'
import { LeftPanel, RightPanel } from './app'
import { createSketch } from './sketch'
import { createGenerationModel, getGeneration } from './generation-state'
import type { Generation } from './types'
import './style.css'

const generation = getGeneration()
const model = createGenerationModel(generation)
const app = document.getElementById('app')!
let textCanvas: HTMLCanvasElement | undefined
let renderText: ((generation: Generation) => void) | undefined

const leftPanelRoot = document.createElement('div')
leftPanelRoot.className = 'panel-root'
document.body.insertBefore(leftPanelRoot, app)

const rightPanelRoot = document.createElement('div')
rightPanelRoot.className = 'panel-root'
document.body.insertBefore(rightPanelRoot, app.nextSibling)

const stage = document.createElement('div')
stage.className = 'stage'
app.appendChild(stage)

let aspectRatio = 1
function fitStage() {
  const style = getComputedStyle(app)
  const bounds = app.getBoundingClientRect()
  const availableWidth = Math.max(0, bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
  const availableHeight = Math.max(0, bounds.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom))
  const width = Math.min(availableWidth, availableHeight * aspectRatio)
  stage.style.width = `${Math.floor(width)}px`
  stage.style.height = `${Math.floor(width / aspectRatio)}px`
}

const stageObserver = new ResizeObserver(fitStage)
stageObserver.observe(app)
fitStage()

const unsubscribeDraft = model.subscribeDraft((nextGeneration) => {
  renderText?.(nextGeneration)
})
const instance = new p5(createSketch(generation, (base, text, renderLayer) => {
  base.classList.add('base-layer')
  textCanvas = text
  renderText = renderLayer
  stage.appendChild(text)
  aspectRatio = base.width / base.height
  fitStage()
  renderLayer(model.draft.value)
}), stage)

render(<LeftPanel model={model} />, leftPanelRoot)
render(<RightPanel model={model} />, rightPanelRoot)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    instance.remove()
    unsubscribeDraft()
    stageObserver.disconnect()
    textCanvas?.remove()
  })
}

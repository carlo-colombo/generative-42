import p5 from 'p5'
import { render } from 'preact'
import { LeftPanel, RightPanel } from './app'
import { StageEditor } from './components/StageEditor'
import { StageToolbar } from './components/ToolButtons'
import { createEditorModel } from './editor-state'
import { createSketch } from './sketch'
import { createGenerationModel, getGeneration } from './generation-state'
import type { Generation } from './types'
import './style.css'

const generation = getGeneration()
const model = createGenerationModel(generation)
const editor = createEditorModel()
const app = document.getElementById('app')!
let textCanvas: HTMLCanvasElement | undefined
let baseCanvas: HTMLCanvasElement | undefined
let renderText: ((generation: Generation) => void) | undefined
let renderSort: ((generation: Generation) => { imageChanged: boolean; resized: boolean }) | undefined
let drawSignature = ''
let previewTimer = 0
let pendingPreview: Generation | null = null

const leftPanelRoot = document.createElement('div')
leftPanelRoot.className = 'panel-root'
document.body.insertBefore(leftPanelRoot, app)

const rightPanelRoot = document.createElement('div')
rightPanelRoot.className = 'panel-root'
document.body.insertBefore(rightPanelRoot, app.nextSibling)

const stageColumn = document.createElement('div')
stageColumn.className = 'stage-column'
app.appendChild(stageColumn)

const toolbarRoot = document.createElement('div')
toolbarRoot.className = 'stage-toolbar-root'
stageColumn.appendChild(toolbarRoot)

const stage = document.createElement('div')
stage.className = 'stage'
stageColumn.appendChild(stage)

const editorRoot = document.createElement('div')
editorRoot.className = 'stage-editor-root'
stage.appendChild(editorRoot)

let aspectRatio = 1
function fitStage() {
  const style = getComputedStyle(app)
  const bounds = app.getBoundingClientRect()
  const availableWidth = Math.max(0, bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
  const toolbarHeight = toolbarRoot.getBoundingClientRect().height
  const gutter = parseFloat(getComputedStyle(stageColumn).rowGap) || 0
  const availableHeight = Math.max(
    0,
    bounds.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - toolbarHeight - gutter,
  )
  const width = Math.min(availableWidth, availableHeight * aspectRatio)
  stage.style.width = `${Math.floor(width)}px`
  stage.style.height = `${Math.floor(width / aspectRatio)}px`
}

const stageObserver = new ResizeObserver(fitStage)
stageObserver.observe(app)
const toolbarObserver = new ResizeObserver(fitStage)
toolbarObserver.observe(toolbarRoot)
fitStage()

function sortSignature(generation: Generation) {
  const { texts, ...rest } = generation
  return JSON.stringify(rest)
}

function applyPreview(generation: Generation) {
  if (!renderSort) return
  drawSignature = sortSignature(generation)
  const result = renderSort(generation)
  if (result.resized && baseCanvas) {
    editor.canvasSize.value = { width: baseCanvas.width, height: baseCanvas.height }
    aspectRatio = baseCanvas.width / baseCanvas.height
    fitStage()
    renderEditor()
  }
  renderText?.(generation)
}

function schedulePreview(generation: Generation) {
  pendingPreview = generation
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => {
    previewTimer = 0
    const next = pendingPreview
    pendingPreview = null
    if (next) applyPreview(next)
  }, 150)
}

const unsubscribeDraft = model.subscribeDraft((nextGeneration) => {
  renderText?.(nextGeneration)
  if (!model.livePreview.value) return
  if (sortSignature(nextGeneration) === drawSignature) return
  schedulePreview(nextGeneration)
})
const unsubscribePreview = model.onPreview(() => applyPreview(model.draft.value))
const instance = new p5(createSketch(generation, (base, text, renderLayer, renderSortLayer) => {
  base.classList.add('base-layer')
  baseCanvas = base
  textCanvas = text
  renderText = renderLayer
  renderSort = renderSortLayer
  stage.appendChild(text)
  aspectRatio = base.width / base.height
  fitStage()
  drawSignature = sortSignature(model.draft.value)
  renderLayer(model.draft.value)
  renderEditor()
}), stage)

function renderEditor() {
  render(<StageEditor model={model} editor={editor} baseCanvas={baseCanvas} />, editorRoot)
}

render(<LeftPanel model={model} />, leftPanelRoot)
render(<RightPanel model={model} editor={editor} />, rightPanelRoot)
render(<StageToolbar editor={editor} model={model} />, toolbarRoot)
renderEditor()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    instance.remove()
    unsubscribeDraft()
    unsubscribePreview()
    stageObserver.disconnect()
    toolbarObserver.disconnect()
    textCanvas?.remove()
  })
}

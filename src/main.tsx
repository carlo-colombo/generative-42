import { render } from 'preact'
import { signal } from '@preact/signals'
import { LeftPanel, RightPanel } from './app'
import { StageEditor } from './components/StageEditor'
import { createEditorModel } from './editor-state'
import { createStage, type StageStatus } from './stage'
import { createGenerationModel, getGeneration, syncGenerationURL } from './generation-state'
import { refreshImageStates, warmImage } from './pwa/image-cache'
import { notifyStageFailed, notifyStageReady, registerServiceWorker } from './pwa/register'
import type { Generation } from './types'
import type { WasmKernels } from './wasm'
import './style.css'

const generation = getGeneration()
const model = createGenerationModel(generation)
const editor = createEditorModel()
editor.selectedLayerId.value = generation.layers[generation.layers.length - 1]?.id ?? null
const app = document.getElementById('app')!
let seedCanvas: HTMLCanvasElement | undefined
let baseCanvas: HTMLCanvasElement | undefined
let renderComposition: ((generation: Generation) => { imageChanged: boolean; resized: boolean }) | undefined
let wasmKernels: WasmKernels | undefined
let drawnSignature = ''
let previewTimer = 0
let pendingPreview: Generation | null = null
let stageReadySent = false
let retriedImage = false

type LoadingStatus = StageStatus | 'loading'
const stageStatus = signal<LoadingStatus>('loading')

function StageLoading() {
  const status = stageStatus.value
  if (status === 'rendered') return null
  const failed = status === 'image-failed' || status === 'wasm-failed'
  const offline = status === 'image-offline'
  const label =
    status === 'image-failed'
      ? 'IMAGE UNAVAILABLE'
      : offline
        ? 'NO IMAGE OFFLINE'
        : status === 'wasm-failed'
          ? 'WASM FAILED'
          : status === 'no-image'
            ? 'NO IMAGE'
            : 'LOADING'
  const hint =
    offline || status === 'image-failed'
      ? 'Upload an image or reconnect'
      : status === 'no-image'
        ? 'Upload an image to start'
        : ''
  return (
    <div className={failed ? 'stage-loading is-error' : 'stage-loading'} role="status" aria-live="polite">
      {!failed && !offline && status !== 'no-image' && <span className="stage-loading-spinner" aria-hidden="true" />}
      <span className="stage-loading-label">{label}</span>
      {hint && <span className="stage-loading-hint">{hint}</span>}
      {offline && (
        <button type="button" className="stage-loading-action" onClick={() => document.getElementById('upload-input')?.click()}>
          Upload image
        </button>
      )}
    </div>
  )
}

const leftPanelRoot = document.createElement('div')
leftPanelRoot.className = 'panel-root'
document.body.insertBefore(leftPanelRoot, app)

const rightPanelRoot = document.createElement('div')
rightPanelRoot.className = 'panel-root'
document.body.insertBefore(rightPanelRoot, app.nextSibling)

const stageColumn = document.createElement('div')
stageColumn.className = 'stage-column'
app.appendChild(stageColumn)

const stage = document.createElement('div')
stage.className = 'stage'
stageColumn.appendChild(stage)

const editorRoot = document.createElement('div')
editorRoot.className = 'stage-editor-root'
stage.appendChild(editorRoot)

const loadingRoot = document.createElement('div')
loadingRoot.className = 'stage-loading-root'
stage.appendChild(loadingRoot)
render(<StageLoading />, loadingRoot)

let aspectRatio = 1
function fitStage() {
  const style = getComputedStyle(app)
  const bounds = app.getBoundingClientRect()
  const availableWidth = Math.max(0, bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
  const availableHeight = Math.max(
    0,
    bounds.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
  )
  const width = Math.min(availableWidth, availableHeight * aspectRatio)
  stage.style.width = `${Math.floor(width)}px`
  stage.style.height = `${Math.floor(width / aspectRatio)}px`
}

const stageObserver = new ResizeObserver(fitStage)
stageObserver.observe(app)
fitStage()

// Below the three-column breakpoint the stage docks to the top of the page so it
// stays visible while the panels scroll. The docked height is smaller, and the
// app box is observed above, so the stage refits without a resize event.
const mobileQuery = window.matchMedia('(max-width: 940px)')
function updateStageDock() {
  app.classList.toggle('is-docked', mobileQuery.matches && window.scrollY > 24)
}
window.addEventListener('scroll', updateStageDock, { passive: true })
mobileQuery.addEventListener('change', updateStageDock)
updateStageDock()

function compositionSignature(generation: Generation) {
  return JSON.stringify(generation)
}

function selectFallbackLayer(generation: Generation) {
  const selected = editor.selectedLayerId.value
  if (selected && generation.layers.some((layer) => layer.id === selected)) return
  editor.selectedLayerId.value = generation.layers[generation.layers.length - 1]?.id ?? null
}

function applyPreview(generation: Generation) {
  if (!renderComposition) return
  const result = renderComposition(generation)
  // A source-image swap cannot be rendered in place, so do not claim the drawn
  // signature matches one.
  drawnSignature = result.imageChanged ? '' : compositionSignature(generation)
  if (result.resized && baseCanvas) {
    editor.canvasSize.value = { width: baseCanvas.width, height: baseCanvas.height }
    aspectRatio = baseCanvas.width / baseCanvas.height
    fitStage()
    renderEditor()
  }
  selectFallbackLayer(generation)
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
  if (!model.livePreview.value) return
  if (compositionSignature(nextGeneration) === drawnSignature) return
  schedulePreview(nextGeneration)
})
const unsubscribePreview = model.onPreview(() => applyPreview(model.draft.value))

// The address bar trails the draft so reloading restores the last rendered
// image without pressing Generate first.
let urlTimer = 0
const unsubscribeURL = model.subscribeDraft(() => {
  if (urlTimer) clearTimeout(urlTimer)
  urlTimer = window.setTimeout(() => {
    urlTimer = 0
    syncGenerationURL(model.draft.value)
  }, 200)
})

function lastStoredImage(): string {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('generation') ?? 'null')
    if (typeof stored !== 'object' || stored === null) return ''
    const image = (stored as { image?: unknown }).image
    return typeof image === 'string' ? image : ''
  } catch {
    return ''
  }
}

let warmedImage = generation.image
const unsubscribeWarm = model.subscribeDraft((next) => {
  if (next.image === warmedImage) return
  warmedImage = next.image
  // The dropdown badges follow the selection, so refresh once the warm attempt
  // has settled instead of on every render.
  void warmImage(next.image).then(() => refreshImageStates())
})

void refreshImageStates().then(() => {
  void warmImage(generation.image)
  // The last stored generation is the image the user will come back to.
  const stored = lastStoredImage()
  if (stored !== generation.image) void warmImage(stored)
})

function handleStageStatus(status: StageStatus) {
  stageStatus.value = status
  if (status === 'wasm-failed' || status === 'image-failed') notifyStageFailed()
  if (status !== 'rendered') return
  if (stageReadySent) return
  stageReadySent = true
  notifyStageReady()
}

// A built-in image that was never cached cannot load offline; retry the load
// once the browser is back online instead of leaving a dead stage.
window.addEventListener('online', () => {
  if (retriedImage) return
  if (stageStatus.value !== 'image-offline' && stageStatus.value !== 'image-failed') return
  retriedImage = true
  location.reload()
})

const stageHandle = createStage(stage, generation, (base, seed, renderLayer, wasm) => {
  baseCanvas = base
  seedCanvas = seed
  wasmKernels = wasm
  renderComposition = renderLayer
  aspectRatio = base.width / base.height
  editor.canvasSize.value = { width: base.width, height: base.height }
  fitStage()
  drawnSignature = compositionSignature(generation)
  renderEditor()
  if (model.livePreview.value && compositionSignature(model.draft.value) !== drawnSignature) {
    schedulePreview(model.draft.value)
  }
}, handleStageStatus)

function renderEditor() {
  render(<StageEditor model={model} editor={editor} baseCanvas={baseCanvas} wasm={wasmKernels} />, editorRoot)
}

render(<LeftPanel model={model} />, leftPanelRoot)
render(<RightPanel model={model} editor={editor} />, rightPanelRoot)
renderEditor()

// Registered before the stage renders: a build that cannot render still has to
// offer the update prompt and the rollback of the build before it.
void registerServiceWorker()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stageHandle.remove()
    unsubscribeDraft()
    unsubscribePreview()
    unsubscribeWarm()
    unsubscribeURL()
    if (urlTimer) clearTimeout(urlTimer)
    window.removeEventListener('scroll', updateStageDock)
    mobileQuery.removeEventListener('change', updateStageDock)
    stageObserver.disconnect()
    seedCanvas?.remove()
  })
}

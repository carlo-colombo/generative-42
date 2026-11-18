import { render } from 'preact'
import { effect, signal } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'
import { LeftPanel, RightPanel } from './app'
import { StageEditor } from './components/StageEditor'
import { MobileTabs } from './components/MobileTabs'
import { Toast } from './components/Toast'
import { announcement, createEditorModel } from './editor-state'
import type { ContentRect } from './frame'
import { createStage, type RenderResult, type Stage, type StageStatus } from './stage'
import { createGenerationModel, getGeneration, syncGenerationURL } from './generation-state'
import { refreshImageStates, warmImage } from './pwa/image-cache'
import { notifyStageFailed, notifyStageReady, registerServiceWorker } from './pwa/register'
import { importShare, takeShareRequest } from './share'
import { createSampleImage } from './sample'
import { addImageFiles } from './upload-images'
import { uploadsStatus } from './uploads'
import type { Generation } from './types'
import type { WasmKernels } from './wasm'
import './style.css'

// A shared image arrives as ?share=... (public/sw.js). Consume the param first:
// what is left of the URL still describes the generation the app had open, so
// the share replaces the source image and keeps the stack.
const shareRequest = takeShareRequest()
const generation = getGeneration()
const model = createGenerationModel(generation)
const editor = createEditorModel()
editor.selectedLayerId.value = generation.layers[generation.layers.length - 1]?.id ?? null

const storedTab = (() => {
  try {
    return sessionStorage.getItem('mobile-tab')
  } catch {
    return null
  }
})()
if (!generation.image) editor.mobileTab.value = 'image'
else if (storedTab === 'image' || storedTab === 'layers') editor.mobileTab.value = storedTab
else editor.mobileTab.value = 'layers'
const stopPanelTab = effect(() => {
  const tab = editor.mobileTab.value
  document.body.dataset.panel = tab
  try {
    sessionStorage.setItem('mobile-tab', tab)
  } catch {
    // Private mode only loses the remembered tab.
  }
})
const app = document.getElementById('app')!
let seedCanvas: HTMLCanvasElement | undefined
let baseCanvas: HTMLCanvasElement | undefined
let renderComposition: ((generation: Generation) => RenderResult) | undefined
let wasmKernels: WasmKernels | undefined
let drawnSignature = ''
let previewTimer = 0
let pendingPreview: Generation | null = null
let stageReadySent = false
let retriedImage = false
let renderedImage = ''
let stageHandle: Stage | undefined
let previewSeq = 0
let imageInFlight: { ref: string; promise: Promise<boolean> } | null = null

type LoadingStatus = StageStatus | 'loading'
const stageStatus = signal<LoadingStatus>('loading')
const stageNotice = signal('')
let uploadBusy = false

async function ingestImages(files: File[]) {
  if (uploadBusy) return
  const images = files.filter((file) => file.type.startsWith('image/'))
  if (images.length === 0) {
    stageNotice.value = 'Drop or paste an image file'
    return
  }
  uploadBusy = true
  stageNotice.value = 'Reading images…'
  try {
    const result = await addImageFiles(images, model)
    stageNotice.value = result.errors.length > 0 ? result.errors.join(' · ') : ''
  } catch {
    stageNotice.value = 'Could not read the image'
  } finally {
    uploadBusy = false
  }
}

async function addSampleImage() {
  if (uploadBusy) return
  uploadBusy = true
  stageNotice.value = 'Creating a sample…'
  try {
    const file = await createSampleImage()
    if (!file) {
      stageNotice.value = 'Could not create the sample image'
      return
    }
    const result = await addImageFiles([file], model)
    stageNotice.value = result.errors.length > 0 ? result.errors.join(' · ') : ''
  } catch {
    stageNotice.value = 'Could not create the sample image'
  } finally {
    uploadBusy = false
  }
}

function StageNotice() {
  const notice = stageNotice.value
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => { stageNotice.value = '' }, 6000)
    return () => clearTimeout(timer)
  }, [notice])
  if (!notice) return null
  return <div className="stage-notice" role="status" aria-live="polite">{notice}</div>
}

function LiveAnnouncer() {
  return <span className="sr-only" role="status" aria-live="polite">{announcement.value}</span>
}

function StageLoading() {
  const status = stageStatus.value
  const [sampleBusy, setSampleBusy] = useState(false)
  if (status === 'rendered') return null
  const failed = status === 'image-failed' || status === 'wasm-failed'
  const offline = status === 'image-offline'
  const imageFailed = status === 'image-failed'
  const unavailable = uploadsStatus.value === 'unavailable'
  const canUpload = status === 'no-image' || offline || imageFailed
  const label =
    imageFailed
      ? 'IMAGE UNAVAILABLE'
      : offline
        ? 'NO IMAGE OFFLINE'
        : status === 'wasm-failed'
          ? 'WASM FAILED'
          : status === 'no-image'
            ? 'NO IMAGE'
            : 'LOADING'
  const hint =
    status === 'no-image'
      ? 'Upload, drop, or paste an image to start'
      : offline
        ? 'Reconnect, or upload a different image'
        : imageFailed
          ? 'Upload an image, or choose another source'
          : ''
  const startSample = async () => {
    setSampleBusy(true)
    await addSampleImage()
    setSampleBusy(false)
  }
  return (
    <div className={failed ? 'stage-loading is-error' : 'stage-loading'}>
      <div className="stage-loading-message" role="status" aria-live="polite">
        {!failed && !offline && status !== 'no-image' && <span className="stage-loading-spinner" aria-hidden="true" />}
        <span className="stage-loading-label">{label}</span>
        {hint && <span className="stage-loading-hint">{hint}</span>}
      </div>
      {canUpload && !unavailable && (
        <div className="stage-loading-actions">
          <button type="button" className="stage-loading-action" onClick={() => document.getElementById('upload-input')?.click()}>
            Upload image
          </button>
          {status === 'no-image' && (
            <button type="button" className="stage-loading-action" disabled={sampleBusy} onClick={() => { void startSample() }}>
              {sampleBusy ? 'Creating…' : 'Try a sample'}
            </button>
          )}
        </div>
      )}
      {canUpload && unavailable && <span className="stage-loading-hint">Image uploads are unavailable in this browser.</span>}
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
render(<><StageLoading /><StageNotice /><LiveAnnouncer /></>, loadingRoot)

const toastRoot = document.createElement('div')
toastRoot.className = 'toast-root'
document.body.appendChild(toastRoot)
render(<Toast />, toastRoot)

const tabsRoot = document.createElement('div')
tabsRoot.className = 'mobile-tabs-root'
stageColumn.appendChild(tabsRoot)
render(<MobileTabs editor={editor} />, tabsRoot)

const mobileQuery = window.matchMedia('(max-width: 940px)')

let aspectRatio = 1
function fitStage() {
  const style = getComputedStyle(app)
  const bounds = app.getBoundingClientRect()
  const availableWidth = Math.max(0, bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
  const tabsHeight = tabsRoot.offsetHeight
  const tabsGap = tabsHeight > 0 ? 8 : 0
  const availableHeight = Math.max(
    0,
    bounds.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - tabsHeight - tabsGap,
  )
  const width = Math.min(availableWidth, availableHeight * aspectRatio)
  stage.style.width = `${Math.floor(width)}px`
  stage.style.height = `${Math.floor(width / aspectRatio)}px`
}

const stageObserver = new ResizeObserver(fitStage)
stageObserver.observe(app)
stageObserver.observe(tabsRoot)
fitStage()

// Below the three-column breakpoint the stage docks to the top of the page so it
// stays visible while the panels scroll. The docked height is smaller, and the
// app box is observed above, so the stage refits without a resize event.
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

function updateEditorArea(content: ContentRect) {
  editor.contentRect.value = content
  editor.canvasSize.value = { width: content.width, height: content.height }
}

async function ensureImage(ref: string): Promise<boolean> {
  if (ref === renderedImage) return true
  const handle = stageHandle
  if (!handle) return false
  if (imageInFlight?.ref === ref) return imageInFlight.promise
  const promise = handle.setImage(ref).catch(() => false)
  imageInFlight = { ref, promise }
  const ok = await promise
  if (imageInFlight?.promise === promise) imageInFlight = null
  if (ok) renderedImage = ref
  return ok
}

async function applyPreview(generation: Generation) {
  if (!renderComposition || !stageHandle) return
  const seq = ++previewSeq
  if (generation.image !== renderedImage) {
    const ok = await ensureImage(generation.image)
    if (seq !== previewSeq) return
    if (!ok) {
      renderedImage = generation.image
      drawnSignature = ''
      renderEditor()
      return
    }
  }
  if (seq !== previewSeq) return
  const result = renderComposition(generation)
  drawnSignature = result.imageChanged ? '' : compositionSignature(generation)
  if (result.resized && baseCanvas) {
    updateEditorArea(result.content)
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
    if (next) void applyPreview(next)
  }, 150)
}

const unsubscribeDraft = model.subscribeDraft((nextGeneration) => {
  if (!model.livePreview.value) return
  if (compositionSignature(nextGeneration) === drawnSignature) return
  schedulePreview(nextGeneration)
})
const unsubscribePreview = model.onPreview(() => {
  if (compositionSignature(model.draft.value) === drawnSignature) return
  void applyPreview(model.draft.value)
})

// The address bar trails the draft so reloading restores the current edits.
let urlTimer = 0
const unsubscribeURL = model.subscribeDraft(() => {
  if (urlTimer) clearTimeout(urlTimer)
  urlTimer = window.setTimeout(() => {
    urlTimer = 0
    syncGenerationURL(model.draft.value)
  }, 200)
})

// Native undo has to keep working inside text fields, so the shortcut only
// reaches the generation history from the panels and the stage. Sliders,
// checkboxes and colour pickers keep app undo; they have no native undo.
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file'])

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true
  if (target.tagName !== 'INPUT') return false
  return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type)
}

function handleHistoryShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey) return
  if (!event.metaKey && !event.ctrlKey) return
  if (isTextEntry(event.target)) return
  const key = event.code === 'KeyZ' ? 'z' : event.code === 'KeyY' ? 'y' : event.key.toLowerCase()
  if (key === 'z') {
    event.preventDefault()
    if (event.shiftKey) model.redo()
    else model.undo()
    return
  }
  if (key === 'y' && !event.shiftKey) {
    event.preventDefault()
    model.redo()
  }
}

window.addEventListener('keydown', handleHistoryShortcut)

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

stageHandle = createStage(stage, generation, (base, seed, renderLayer, wasm, content) => {
  baseCanvas = base
  seedCanvas = seed
  wasmKernels = wasm
  renderComposition = renderLayer
  aspectRatio = base.width / base.height
  updateEditorArea(content)
  fitStage()
  drawnSignature = ''
  renderEditor()
  void applyPreview(model.draft.value)
}, handleStageStatus)

function renderEditor() {
  render(<StageEditor model={model} editor={editor} baseCanvas={baseCanvas} wasm={wasmKernels} />, editorRoot)
}

render(<LeftPanel model={model} />, leftPanelRoot)
render(<RightPanel model={model} editor={editor} />, rightPanelRoot)
renderEditor()

const dropOverlay = document.createElement('div')
dropOverlay.className = 'drop-overlay'
dropOverlay.setAttribute('aria-hidden', 'true')
const dropOverlayLabel = document.createElement('span')
dropOverlayLabel.textContent = 'Drop image to upload'
dropOverlay.appendChild(dropOverlayLabel)
document.body.appendChild(dropOverlay)

let dragDepth = 0

function hasFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function handleDragEnter(event: DragEvent) {
  if (!hasFileDrag(event)) return
  dragDepth += 1
  document.body.classList.add('is-dragging')
}

function handleDragLeave(event: DragEvent) {
  dragDepth = Math.max(0, dragDepth - 1)
  if (event.relatedTarget === null || dragDepth === 0) resetDrag()
}

function handleDragOver(event: DragEvent) {
  if (!hasFileDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function resetDrag() {
  dragDepth = 0
  document.body.classList.remove('is-dragging')
}

function handleDrop(event: DragEvent) {
  if (!hasFileDrag(event)) return
  event.preventDefault()
  resetDrag()
  void ingestImages(Array.from(event.dataTransfer?.files ?? []))
}

function handlePaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? [])
  if (files.length === 0) {
    for (const item of Array.from(event.clipboardData?.items ?? [])) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (files.length === 0) return
  event.preventDefault()
  void ingestImages(files)
}

window.addEventListener('dragenter', handleDragEnter)
window.addEventListener('dragleave', handleDragLeave)
window.addEventListener('dragover', handleDragOver)
window.addEventListener('dragend', resetDrag)
window.addEventListener('drop', handleDrop)
window.addEventListener('paste', handlePaste)

// Registered before the stage renders: a build that cannot render still has to
// offer the update prompt and the rollback of the build before it.
void registerServiceWorker()

if (shareRequest) void importShare(shareRequest, model)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stageHandle?.remove()
    unsubscribeDraft()
    unsubscribePreview()
    unsubscribeWarm()
    unsubscribeURL()
    stopPanelTab()
    if (urlTimer) clearTimeout(urlTimer)
    window.removeEventListener('scroll', updateStageDock)
    window.removeEventListener('keydown', handleHistoryShortcut)
    window.removeEventListener('dragenter', handleDragEnter)
    window.removeEventListener('dragleave', handleDragLeave)
    window.removeEventListener('dragover', handleDragOver)
    window.removeEventListener('dragend', resetDrag)
    window.removeEventListener('drop', handleDrop)
    window.removeEventListener('paste', handlePaste)
    dropOverlay.remove()
    document.body.classList.remove('is-dragging')
    mobileQuery.removeEventListener('change', updateStageDock)
    stageObserver.disconnect()
    seedCanvas?.remove()
  })
}

import { useEffect, useRef, useState } from 'preact/hooks'
import { shareLink, type GenerationModel } from '../generation-state'
import type { Generation } from '../types'
import { downloadImage } from '../surface'
import { imageLabel } from '../uploads'
import { ControlField } from './ControlField'

function fallbackCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  return copied
}

function generationFileName(generation: Generation): string {
  const imageName = imageLabel(generation.image).replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-') || 'image'
  return `gen-${generation.seed}-${imageName}.png`
}

export function Actions({ model }: { model: GenerationModel }) {
  const generation = model.draft.value
  const [copied, setCopied] = useState(false)
  const [localOnly, setLocalOnly] = useState(false)
  const [message, setMessage] = useState('')
  const copyTimer = useRef<number | undefined>(undefined)
  const canShare = typeof navigator.share === 'function'
  const localHint = 'Uploads and large stacks stay in this browser, so the link opens only here.'

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 4000)
    return () => clearTimeout(timer)
  }, [message])

  const flashCopied = (local: boolean) => {
    setLocalOnly(local)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 2400)
  }

  const copy = async () => {
    setMessage('')
    const { url, local } = shareLink(generation)
    let ok = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        ok = true
      } catch {
        ok = false
      }
    }
    if (!ok) ok = fallbackCopy(url)
    if (!ok) {
      setCopied(false)
      setMessage('Could not copy the link')
      return
    }
    flashCopied(local || generation.image.startsWith('upload:'))
  }

  const share = async () => {
    setMessage('')
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.base-layer')
    if (canvas && canvas.dataset.hasSource === 'true' && typeof navigator.canShare === 'function') {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (blob) {
        const file = new File([blob], generationFileName(generation), { type: 'image/png' })
        let fileShare = false
        try {
          fileShare = navigator.canShare({ files: [file] })
        } catch {
          fileShare = false
        }
        if (fileShare) {
          try {
            await navigator.share({ files: [file], title: 'Generative 42' })
            return
          } catch (error) {
            if ((error as DOMException)?.name === 'AbortError') return
          }
        }
      }
    }
    const { url, local } = shareLink(generation)
    const localLink = local || generation.image.startsWith('upload:')
    try {
      await navigator.share({ title: 'Generative 42', url })
      if (localLink) setMessage(`Shared. ${localHint}`)
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') setMessage('Could not share the link')
    }
  }

  const download = () => {
    const baseCanvas = document.querySelector<HTMLCanvasElement>('canvas.base-layer')
    if (!baseCanvas || baseCanvas.dataset.hasSource !== 'true') return
    downloadImage(baseCanvas, generationFileName(generation))
  }

  return <footer className="panel-footer">
    <ControlField label="Seed">
      <div className="seed-row">
        <input aria-label="Seed" data-commit-enter type="number" min="1" step="1" value={generation.seed} onInput={(event) => model.setField('seed', Math.max(1, parseInt(event.currentTarget.value, 10) || 1))} />
        <button type="button" onClick={model.nextSeed}>Next</button>
      </div>
    </ControlField>
    <label className="checkbox-field">
      <input type="checkbox" checked={generation.showSeed} onChange={(event) => model.setField('showSeed', event.currentTarget.checked)} />
      Show seed label
    </label>
    <button type="button" className="primary" aria-label="Generate a new random seed" title="New random seed" onClick={model.randomSeed}>Generate</button>
    <div className="history-row">
      <button type="button" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" onClick={model.undo} disabled={!model.history.value.canUndo}>Undo</button>
      <button type="button" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" onClick={model.redo} disabled={!model.history.value.canRedo}>Redo</button>
    </div>
    <div className="preview-row">
      <label className="checkbox-field">
        <input type="checkbox" checked={model.livePreview.value} onChange={(event) => { model.livePreview.value = event.currentTarget.checked }} />
        Live preview
      </label>
      <button type="button" onClick={model.requestPreview} disabled={model.livePreview.value}>Preview</button>
    </div>
    <div className="action-row">
      <button type="button" title="Copy a link to this generation" onClick={() => { void copy() }}>{copied ? 'Copied' : 'Copy link'}</button>
      {canShare && <button type="button" title="Share this generation" onClick={() => { void share() }}>Share</button>}
      <button type="button" aria-label="Download PNG" title="Download PNG" onClick={download}>Download</button>
    </div>
    {copied && localOnly && <p className="text-hint">Copied. {localHint}</p>}
    {message && <p className="text-hint" role="status">{message}</p>}
    <span className="sr-only" role="status">{copied ? `Link copied.${localOnly ? ` ${localHint}` : ''}` : ''}</span>
  </footer>
}

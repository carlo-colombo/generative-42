import { useEffect, useRef, useState } from 'preact/hooks'
import { ControlField } from './ControlField'
import type { GenerationModel } from '../generation-state'
import { addUploads, deleteUpload, isUploadRef, loadUploads, MAX_UPLOADS, uploadRef, uploads, uploadsStatus } from '../uploads'

const UPLOAD_ERRORS_KEY = 'upload-errors'

function takeUploadErrors(): string {
  try {
    const stored = sessionStorage.getItem(UPLOAD_ERRORS_KEY) ?? ''
    if (stored) sessionStorage.removeItem(UPLOAD_ERRORS_KEY)
    return stored
  } catch {
    return ''
  }
}

function keepUploadErrors(message: string): void {
  try {
    if (message) sessionStorage.setItem(UPLOAD_ERRORS_KEY, message)
  } catch {
    // A storage failure only loses the notice.
  }
}

export function SourceControls({ model, images }: { model: GenerationModel; images: string[] }) {
  const generation = model.draft.value
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(takeUploadErrors)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploaded = uploads.value
  const unavailable = uploadsStatus.value === 'unavailable'

  useEffect(() => {
    void loadUploads()
  }, [])

  const selectImage = (ref: string) => {
    model.setField('image', ref)
    model.applyGeneration()
  }

  const handleFiles = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (files.length === 0) return
    setBusy(true)
    setError('')
    const result = await addUploads(files)
    setBusy(false)
    setError(result.errors.join(' · '))
    const first = result.added[0]
    if (first) {
      keepUploadErrors(result.errors.join(' · '))
      selectImage(uploadRef(first.id))
    }
  }

  const removeUpload = async (id: string) => {
    const wasSelected = generation.image === uploadRef(id)
    try {
      await deleteUpload(id)
    } catch {
      setError('Could not remove the uploaded image')
      return
    }
    if (!wasSelected) return
    const fallback = uploads.value[0] ? uploadRef(uploads.value[0].id) : images[0] ? `/assets/${images[0]}` : ''
    selectImage(fallback)
  }

  const known = [
    ...images.map((file) => `/assets/${file}`),
    ...uploaded.map((image) => uploadRef(image.id)),
  ]

  return <section className="panel-section">
    <h2 className="section-title">Image</h2>
    <ControlField label="Source">
      <select id="image-select" value={generation.image} onChange={(event) => selectImage((event.currentTarget as HTMLSelectElement).value)}>
        {generation.image === '' && <option value="">No image</option>}
        <optgroup label="Built in">
          {images.map((file) => <option value={`/assets/${file}`}>{file}</option>)}
        </optgroup>
        {uploaded.length > 0 && <optgroup label="Uploaded">
          {uploaded.map((image) => <option value={uploadRef(image.id)}>{image.name}</option>)}
        </optgroup>}
        {!known.includes(generation.image) && generation.image !== '' && <option value={generation.image}>{isUploadRef(generation.image) ? 'Missing upload (not in this browser)' : generation.image}</option>}
      </select>
    </ControlField>
    <div className="upload-row">
      <button type="button" onClick={() => fileInput.current?.click()} disabled={busy || unavailable}>
        {busy ? 'Reading images…' : 'Upload images'}
      </button>
      <input
        ref={fileInput}
        className="upload-input"
        type="file"
        accept="image/*"
        multiple
        onChange={handleFiles}
      />
    </div>
    {error && <p className="text-hint">{error}</p>}
    {uploaded.length > 0 && <div className="upload-grid">
      {uploaded.map((image) => {
        const ref = uploadRef(image.id)
        return <div className={generation.image === ref ? 'upload-tile selected' : 'upload-tile'} title={`${image.name} · ${image.width}×${image.height}`}>
          <button type="button" className="upload-select" aria-label={`Use ${image.name}`} onClick={() => selectImage(ref)}>
            <img src={image.thumb} alt="" loading="lazy" />
          </button>
          <button type="button" className="upload-remove" aria-label={`Remove ${image.name}`} onClick={() => { void removeUpload(image.id) }}>×</button>
        </div>
      })}
    </div>}
    <p className="hint-text">
      {unavailable
        ? 'Uploads are disabled: this browser blocks local image storage.'
        : uploaded.length === 0 && images.length === 0
          ? 'No images are available: upload one to start. Uploads stay on this device, in this browser.'
          : `Uploads stay on this device, in this browser. ${uploaded.length}/${MAX_UPLOADS} stored.`}
    </p>
  </section>
}

import { useEffect, useRef, useState } from 'preact/hooks'
import { ControlField } from './ControlField'
import type { GenerationModel } from '../generation-state'
import { cachedImagePaths } from '../pwa/image-cache'
import { online } from '../pwa/update-state'
import { shareHintVisible, shareNotice } from '../share'
import {
  addUploads,
  deleteUpload,
  isUploadRef,
  keepUploadErrors,
  loadUploads,
  MAX_UPLOADS,
  renameUpload,
  takeUploadErrors,
  uploadRef,
  uploads,
  uploadsStatus,
  type UploadedImage,
} from '../uploads'

function availabilityHint(total: number, cached: number, isOnline: boolean): string {
  if (total === 0) return ''
  if (cached === total) return `All ${total} built-in images are available offline.`
  if (isOnline) return `${cached}/${total} built-in images are available offline. ☁ marks images that need a connection the first time.`
  return `${cached}/${total} built-in images are available offline. Reconnect to use the rest.`
}

export function SourceControls({ model, images }: { model: GenerationModel; images: string[] }) {
  const generation = model.draft.value
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(takeUploadErrors)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const uploaded = uploads.value
  const unavailable = uploadsStatus.value === 'unavailable'
  const notice = shareNotice.value
  const cached = cachedImagePaths.value
  const isOnline = online.value
  const cachedCount = images.filter((file) => cached.has(`/assets/${file}`)).length

  useEffect(() => {
    void loadUploads()
  }, [])

  const selectImage = (ref: string) => {
    shareNotice.value = ''
    model.setField('image', ref)
    model.applyGeneration()
  }

  const handleFiles = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (files.length === 0) return
    shareNotice.value = ''
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
    if (renamingId === id) cancelRename()
    if (!wasSelected) return
    const fallback = uploads.value[0] ? uploadRef(uploads.value[0].id) : images[0] ? `/assets/${images[0]}` : ''
    selectImage(fallback)
  }

  const startRename = (image: UploadedImage) => {
    setError('')
    setRenamingId(image.id)
    setRenameValue(image.name)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  const commitRename = () => {
    const id = renamingId
    const value = renameValue
    cancelRename()
    if (!id) return
    renameUpload(id, value).catch(() => setError('Could not rename the uploaded image'))
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
          {images.map((file) => {
            const path = `/assets/${file}`
            const isCached = cached.has(path)
            const disabled = !isCached && !isOnline
            return <option
              value={path}
              disabled={disabled}
              title={disabled
                ? 'Not saved on this device yet. Reconnect to use it.'
                : isCached ? 'Available offline' : 'Online only until it has loaded once'}
            >{disabled ? `${file} — not available offline` : isCached ? file : `${file} ☁`}</option>
          })}
        </optgroup>
        {uploaded.length > 0 && <optgroup label="Uploaded · local">
          {uploaded.map((image) => <option value={uploadRef(image.id)}>{image.name}</option>)}
        </optgroup>}
        {!known.includes(generation.image) && generation.image !== '' && <option value={generation.image}>{isUploadRef(generation.image) ? 'Missing upload (not in this browser)' : generation.image}</option>}
      </select>
    </ControlField>
    {images.length > 0 && <p className="hint-text">{availabilityHint(images.length, cachedCount, isOnline)}</p>}
    <div className="upload-row">
      <button type="button" onClick={() => fileInput.current?.click()} disabled={busy || unavailable}>
        {busy ? 'Reading images…' : 'Upload images'}
      </button>
      <input
        id="upload-input"
        ref={fileInput}
        className="upload-input"
        type="file"
        accept="image/*"
        multiple
        onChange={handleFiles}
      />
    </div>
    {error && <p className="text-hint">{error}</p>}
    {notice && <p className="text-hint">{notice}</p>}
    {uploaded.length > 0 && <div className="upload-grid">
      {uploaded.map((image) => {
        const ref = uploadRef(image.id)
        const renaming = renamingId === image.id
        const className = [
          'upload-tile',
          generation.image === ref ? 'selected' : '',
          renaming ? 'renaming' : '',
        ].filter(Boolean).join(' ')
        return <div className={className} title={`${image.name} · ${image.width}×${image.height}`}>
          {renaming
            ? <input
              aria-label={`Rename ${image.name}`}
              className="upload-rename-input"
              type="text"
              value={renameValue}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onInput={(event) => setRenameValue(event.currentTarget.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename()
                if (event.key === 'Escape') cancelRename()
              }}
            />
            : <>
              <button type="button" className="upload-select" aria-label={`Use ${image.name}`} onClick={() => selectImage(ref)}>
                <img src={image.thumb} alt="" loading="lazy" />
              </button>
              <button type="button" className="upload-rename" aria-label={`Rename ${image.name}`} title="Rename" onClick={() => startRename(image)}>✎</button>
              <button type="button" className="upload-remove" aria-label={`Remove ${image.name}`} title="Remove" onClick={() => { void removeUpload(image.id) }}>×</button>
            </>}
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
    {shareHintVisible && <p className="hint-text">Installed on Android, the app takes an image from the share sheet of any app.</p>}
  </section>
}

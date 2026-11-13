import { useEffect, useRef, useState } from 'preact/hooks'
import { ControlField } from './ControlField'
import type { GenerationModel } from '../generation-state'
import { cachedImagePaths } from '../pwa/image-cache'
import { online } from '../pwa/update-state'
import { shareHintVisible, shareNotice } from '../share'
import { archiveFileName, buildArchive, parseArchive } from '../upload-archive'
import {
  addUploads,
  deleteUpload,
  exportUploads,
  importUploadsBlobs,
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
  const [archiveBusy, setArchiveBusy] = useState<'export' | 'import' | ''>('')
  const [archiveStatus, setArchiveStatus] = useState('')
  const [error, setError] = useState(takeUploadErrors)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const archiveInput = useRef<HTMLInputElement>(null)
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
    if (files.length === 0 || archiveBusy !== '') return
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

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const exportAll = async () => {
    if (archiveBusy) return
    setError('')
    setArchiveStatus('')
    setArchiveBusy('export')
    try {
      const entries = await exportUploads()
      if (entries.length === 0) {
        setError('No uploaded images to export')
        return
      }
      const archive = buildArchive(entries.map(({ image, blob }) => ({
        name: image.name,
        width: image.width,
        height: image.height,
        type: blob.type,
        createdAt: image.createdAt,
        blob,
      })))
      downloadBlob(archive, archiveFileName())
      setArchiveStatus(`Exported ${entries.length} image${entries.length === 1 ? '' : 's'}`)
    } catch {
      setError('Could not export the uploaded images')
    } finally {
      setArchiveBusy('')
    }
  }

  const importArchive = async (file: File | undefined) => {
    if (!file || archiveBusy) return
    setError('')
    setArchiveStatus('')
    setArchiveBusy('import')
    const room = Math.max(0, MAX_UPLOADS - uploads.value.length)
    try {
      const entries = await parseArchive(file)
      const result = await importUploadsBlobs(entries.map((entry) => ({ name: entry.name, type: entry.type, blob: entry.blob })))
      setError(result.errors.join(' · '))
      if (result.added.length === 0) return
      const skipped = Math.max(0, entries.length - Math.min(entries.length, room))
      const count = `Imported ${result.added.length} image${result.added.length === 1 ? '' : 's'}`
      setArchiveStatus(skipped > 0 ? `${count}, ${skipped} skipped: limit of ${MAX_UPLOADS}` : count)
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Could not read the archive')
    } finally {
      setArchiveBusy('')
    }
  }

  const handleArchiveFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    await importArchive(file)
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
      <button type="button" onClick={() => fileInput.current?.click()} disabled={busy || archiveBusy !== '' || unavailable}>
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
    <div className="upload-archive-row">
      <button
        type="button"
        onClick={() => { void exportAll() }}
        disabled={archiveBusy !== '' || busy || unavailable || uploaded.length === 0}
      >
        {archiveBusy === 'export' ? `Packing ${uploaded.length} image${uploaded.length === 1 ? '' : 's'}…` : 'Export all'}
      </button>
      <button
        type="button"
        onClick={() => archiveInput.current?.click()}
        disabled={archiveBusy !== '' || busy || unavailable}
      >
        {archiveBusy === 'import' ? 'Reading archive…' : 'Import'}
      </button>
      <input
        id="upload-import-input"
        ref={archiveInput}
        className="upload-input"
        type="file"
        accept=".g42images,application/octet-stream"
        onChange={handleArchiveFile}
      />
    </div>
    {error && <p className="text-hint">{error}</p>}
    {archiveStatus && <p className="text-hint" role="status">{archiveStatus}</p>}
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

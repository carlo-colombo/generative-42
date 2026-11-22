import { signal } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'

import { extractExif } from './image-metadata'
import { appUrl } from './paths'

export const UPLOAD_PREFIX = 'upload:'
export const MAX_UPLOADS = 24
export const MAX_UPLOAD_DIMENSION = 4096
const MAX_UPLOAD_NAME = 80

const DB_NAME = 'generative42'
const DB_VERSION = 1
const META_STORE = 'uploads'
const FILE_STORE = 'upload-files'
const THUMB_SIZE = 168

export type UploadedImage = {
  id: string
  name: string
  width: number
  height: number
  thumb: string
  createdAt: number
  bytes: number
  hasExif?: boolean
}

export type UploadStatus = 'idle' | 'ready' | 'unavailable'

export const uploads = signal<UploadedImage[]>([])
export const uploadsStatus = signal<UploadStatus>('idle')

const objectUrls = new Map<string, string>()
let persistRequested = false

export function uploadId(ref: string): string | null {
  return ref.startsWith(UPLOAD_PREFIX) ? ref.slice(UPLOAD_PREFIX.length) : null
}

export function uploadRef(id: string): string {
  return `${UPLOAD_PREFIX}${id}`
}

export function isUploadRef(ref: string): boolean {
  return ref.startsWith(UPLOAD_PREFIX)
}

export function uploadDisplayName(name: string, fallback: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, MAX_UPLOAD_NAME).trim()
  return cleaned || fallback
}

export function imageLabel(ref: string): string {
  const id = uploadId(ref)
  if (id === null) return ref.split('/').pop() ?? ref
  return uploads.value.find((image) => image.id === id)?.name ?? 'Uploaded image'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the upload store'))
    request.onblocked = () => reject(new Error('The upload store is blocked by another tab'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Upload store request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Upload store transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('Upload store transaction aborted'))
  })
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

async function persistStorage(): Promise<void> {
  if (persistRequested) return
  persistRequested = true
  try {
    await navigator.storage?.persist?.()
  } catch {
    // A refused persist grant only weakens eviction protection.
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the image'))
    }, type, quality)
  })
}

function drawCanvas(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Missing 2D context for the upload')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

function thumbnail(bitmap: ImageBitmap): string {
  const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height))
  const canvas = drawCanvas(bitmap, bitmap.width * scale, bitmap.height * scale)
  return canvas.toDataURL('image/webp', 0.72)
}

type PreparedUpload = { blob: Blob; width: number; height: number; thumb: string }

async function prepareUpload(file: File): Promise<PreparedUpload> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_UPLOAD_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const blob = scale === 1 && file.size > 0
      ? file
      : await canvasBlob(drawCanvas(bitmap, width, height), file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92)
    return { blob, width, height, thumb: thumbnail(bitmap) }
  } finally {
    bitmap.close()
  }
}

async function storeUpload(image: UploadedImage, blob: Blob, exif: Uint8Array | null): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([META_STORE, FILE_STORE], 'readwrite')
    tx.objectStore(META_STORE).put(image)
    const exifBuffer = exif?.buffer.slice(exif.byteOffset, exif.byteOffset + exif.byteLength) as ArrayBuffer | undefined
    tx.objectStore(FILE_STORE).put({ id: image.id, blob, exif: exifBuffer ? new Blob([exifBuffer]) : undefined })
    await transactionDone(tx)
  } finally {
    db.close()
  }
}

export async function loadUploads(): Promise<void> {
  try {
    const db = await openDb()
    let records: UploadedImage[]
    let stored: { id: string; blob?: Blob; exif?: Blob }[]
    try {
      records = await requestResult(db.transaction(META_STORE).objectStore(META_STORE).getAll()) as UploadedImage[]
      stored = await requestResult(db.transaction(FILE_STORE).objectStore(FILE_STORE).getAll()) as { id: string; blob?: Blob; exif?: Blob }[]
    } finally {
      db.close()
    }
    const files = new Map(stored.map((record) => [record.id, record]))
    const images = await Promise.all(records.map(async (record) => {
      if (typeof record.hasExif === 'boolean') return record
      const file = files.get(record.id)
      const hasExif = file?.exif ? file.exif.size > 0 : file?.blob ? Boolean(await extractExif(file.blob)) : false
      return { ...record, hasExif }
    }))
    if (images.some((image) => records.find((record) => record.id === image.id)?.hasExif === undefined)) {
      try {
        const updateDb = await openDb()
        try {
          const tx = updateDb.transaction(META_STORE, 'readwrite')
          for (const image of images) tx.objectStore(META_STORE).put(image)
          await transactionDone(tx)
        } finally {
          updateDb.close()
        }
      } catch {
        // The marker still works for this session if a metadata migration fails.
      }
    }
    uploads.value = images
      .map((record) => ({ ...record, bytes: typeof record.bytes === 'number' && record.bytes > 0 ? record.bytes : 0 }))
      .sort((a, b) => b.createdAt - a.createdAt)
    uploadsStatus.value = 'ready'
  } catch {
    uploadsStatus.value = 'unavailable'
  }
}

export async function addUploads(files: File[], preservedExif: (Blob | undefined)[] = []): Promise<{ added: UploadedImage[]; errors: string[] }> {
  const errors: string[] = []
  const added: UploadedImage[] = []
  // The share import runs before the panel has loaded the store, so the count
  // that fills MAX_UPLOADS has to come from the store, not from the signal.
  if (uploadsStatus.value === 'idle') await loadUploads()
  const room = Math.max(0, MAX_UPLOADS - uploads.value.length)
  if (room === 0) return { added, errors: [`Limit of ${MAX_UPLOADS} uploaded images`] }
  await persistStorage()
  for (const [index, file] of files.slice(0, room).entries()) {
    if (!file.type.startsWith('image/')) {
      errors.push(`${file.name} is not an image`)
      continue
    }
    try {
      const exif = preservedExif[index]
        ? new Uint8Array(await preservedExif[index]!.arrayBuffer())
        : await extractExif(file)
      const prepared = await prepareUpload(file)
      const image: UploadedImage = {
        id: newId(),
        name: uploadDisplayName(file.name, 'upload'),
        width: prepared.width,
        height: prepared.height,
        thumb: prepared.thumb,
        createdAt: Date.now(),
        bytes: prepared.blob.size,
        hasExif: Boolean(exif?.length),
      }
      await storeUpload(image, prepared.blob, exif)
      added.push(image)
    } catch {
      errors.push(`${file.name} could not be read`)
    }
  }
  if (files.length > room) errors.push(`Only ${room} more image${room === 1 ? '' : 's'} allowed`)
  if (added.length > 0) {
    uploads.value = [...added, ...uploads.value]
    uploadsStatus.value = 'ready'
  }
  return { added, errors }
}

export async function exportUploads(): Promise<{ image: UploadedImage; blob: Blob; exif?: Blob }[]> {
  const db = await openDb()
  let records: UploadedImage[]
  let stored: { id: string; blob?: Blob; exif?: Blob }[]
  try {
    records = await requestResult(db.transaction(META_STORE).objectStore(META_STORE).getAll()) as UploadedImage[]
    stored = await requestResult(db.transaction(FILE_STORE).objectStore(FILE_STORE).getAll()) as { id: string; blob?: Blob; exif?: Blob }[]
  } finally {
    db.close()
  }
  const files = new Map(stored.map((record) => [record.id, record]))
  return records
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((image) => {
      const stored = files.get(image.id)
      return stored?.blob ? [{ image, blob: stored.blob, exif: stored.exif }] : []
    })
}

export async function importUploadsBlobs(entries: { name: string; type: string; blob: Blob; exif?: Blob }[]): Promise<{ added: UploadedImage[]; errors: string[] }> {
  // Archive payloads are already encoded images, so the normal add path only
  // decodes them to measure and thumbnail; it keeps the bytes untouched when
  // the image is within MAX_UPLOAD_DIMENSION.
  return addUploads(
    entries.map((entry) => new File([entry.blob], entry.name, { type: entry.type })),
    entries.map((entry) => entry.exif),
  )
}

export async function deleteUpload(id: string): Promise<void> {
  const url = objectUrls.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    objectUrls.delete(id)
  }
  const db = await openDb()
  try {
    const tx = db.transaction([META_STORE, FILE_STORE], 'readwrite')
    tx.objectStore(META_STORE).delete(id)
    tx.objectStore(FILE_STORE).delete(id)
    await transactionDone(tx)
  } finally {
    db.close()
  }
  uploads.value = uploads.value.filter((image) => image.id !== id)
}

export async function renameUpload(id: string, name: string): Promise<string | null> {
  const current = uploads.value.find((image) => image.id === id)
  if (!current) return null
  const next = uploadDisplayName(name, current.name)
  if (next === current.name) return next
  const updated: UploadedImage = { ...current, name: next }
  const db = await openDb()
  try {
    const tx = db.transaction(META_STORE, 'readwrite')
    tx.objectStore(META_STORE).put(updated)
    await transactionDone(tx)
  } finally {
    db.close()
  }
  uploads.value = uploads.value.map((image) => (image.id === id ? updated : image))
  return next
}

export async function uploadBytes(): Promise<number> {
  const db = await openDb()
  try {
    const records = await requestResult(db.transaction(META_STORE).objectStore(META_STORE).getAll()) as UploadedImage[]
    const stored = await requestResult(db.transaction(FILE_STORE).objectStore(FILE_STORE).getAll()) as { id: string; blob?: Blob; exif?: Blob }[]
    const files = new Map(stored.map((record) => [record.id, record]))
    let total = 0
    for (const record of records) {
      const file = files.get(record.id)
      // Older rows without a recorded size still count their stored image bytes.
      total += typeof record.bytes === 'number' && record.bytes > 0 ? record.bytes : file?.blob?.size ?? 0
      total += file?.exif?.size ?? 0
    }
    return total
  } finally {
    db.close()
  }
}

export async function clearUploads(): Promise<void> {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url)
  objectUrls.clear()
  const db = await openDb()
  try {
    const tx = db.transaction([META_STORE, FILE_STORE], 'readwrite')
    tx.objectStore(META_STORE).clear()
    tx.objectStore(FILE_STORE).clear()
    await transactionDone(tx)
  } finally {
    db.close()
  }
  uploads.value = []
}

export async function sourceExif(ref: string): Promise<Uint8Array | null> {
  if (!ref) return null
  const id = uploadId(ref)
  if (id !== null) {
    const db = await openDb()
    let record: { blob?: Blob; exif?: Blob } | undefined
    try {
      record = await requestResult(db.transaction(FILE_STORE).objectStore(FILE_STORE).get(id)) as { blob?: Blob; exif?: Blob } | undefined
    } finally {
      db.close()
    }
    if (record?.exif) return new Uint8Array(await record.exif.arrayBuffer())
    return record?.blob ? extractExif(record.blob) : null
  }
  const response = await fetch(appUrl(ref))
  if (!response.ok) throw new Error(`Could not read metadata from ${ref}`)
  return extractExif(await response.blob())
}

export async function imageSource(ref: string): Promise<string> {
  const id = uploadId(ref)
  if (id === null) return appUrl(ref)
  const cached = objectUrls.get(id)
  if (cached) return cached
  const db = await openDb()
  let record: { blob?: Blob } | undefined
  try {
    record = await requestResult(db.transaction(FILE_STORE).objectStore(FILE_STORE).get(id)) as { blob?: Blob } | undefined
  } finally {
    db.close()
  }
  const blob = record?.blob
  if (!blob) throw new Error(`Uploaded image ${id} is missing from this browser`)
  const url = URL.createObjectURL(blob)
  objectUrls.set(id, url)
  return url
}

export function useImageSource(ref: string): string | null {
  const [source, setSource] = useState<string | null>(isUploadRef(ref) ? null : ref)
  useEffect(() => {
    if (!isUploadRef(ref)) {
      setSource(appUrl(ref))
      return
    }
    setSource(null)
    let active = true
    imageSource(ref)
      .then((url) => { if (active) setSource(url) })
      .catch(() => { if (active) setSource(null) })
    return () => { active = false }
  }, [ref])
  return source
}

import { signal } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'

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

// Upload notices are reported in the Image section, but the flow that produces
// them (selecting a new image, importing a shared file) reloads the page, so
// they cross that reload in sessionStorage.
const UPLOAD_ERRORS_KEY = 'upload-errors'

export function takeUploadErrors(): string {
  try {
    const stored = sessionStorage.getItem(UPLOAD_ERRORS_KEY) ?? ''
    if (stored) sessionStorage.removeItem(UPLOAD_ERRORS_KEY)
    return stored
  } catch {
    return ''
  }
}

export function keepUploadErrors(message: string): void {
  try {
    if (message) sessionStorage.setItem(UPLOAD_ERRORS_KEY, message)
  } catch {
    // A storage failure only loses the notice.
  }
}

export type UploadedImage = {
  id: string
  name: string
  width: number
  height: number
  thumb: string
  createdAt: number
  bytes: number
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

async function storeUpload(image: UploadedImage, blob: Blob): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([META_STORE, FILE_STORE], 'readwrite')
    tx.objectStore(META_STORE).put(image)
    tx.objectStore(FILE_STORE).put({ id: image.id, blob })
    await transactionDone(tx)
  } finally {
    db.close()
  }
}

export async function loadUploads(): Promise<void> {
  try {
    const db = await openDb()
    let records: UploadedImage[]
    try {
      records = await requestResult(db.transaction(META_STORE).objectStore(META_STORE).getAll()) as UploadedImage[]
    } finally {
      db.close()
    }
    uploads.value = records
      .map((record) => ({ ...record, bytes: typeof record.bytes === 'number' && record.bytes > 0 ? record.bytes : 0 }))
      .sort((a, b) => b.createdAt - a.createdAt)
    uploadsStatus.value = 'ready'
  } catch {
    uploadsStatus.value = 'unavailable'
  }
}

export async function addUploads(files: File[]): Promise<{ added: UploadedImage[]; errors: string[] }> {
  const errors: string[] = []
  const added: UploadedImage[] = []
  // The share import runs before the panel has loaded the store, so the count
  // that fills MAX_UPLOADS has to come from the store, not from the signal.
  if (uploadsStatus.value === 'idle') await loadUploads()
  const room = Math.max(0, MAX_UPLOADS - uploads.value.length)
  if (room === 0) return { added, errors: [`Limit of ${MAX_UPLOADS} uploaded images`] }
  await persistStorage()
  for (const file of files.slice(0, room)) {
    if (!file.type.startsWith('image/')) {
      errors.push(`${file.name} is not an image`)
      continue
    }
    try {
      const prepared = await prepareUpload(file)
      const image: UploadedImage = {
        id: newId(),
        name: uploadDisplayName(file.name, 'upload'),
        width: prepared.width,
        height: prepared.height,
        thumb: prepared.thumb,
        createdAt: Date.now(),
        bytes: prepared.blob.size,
      }
      await storeUpload(image, prepared.blob)
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
    let total = 0
    for (const record of records) {
      if (typeof record.bytes === 'number' && record.bytes > 0) {
        total += record.bytes
        continue
      }
      // Rows written before sizes were recorded still count against the budget.
      const stored = await requestResult(db.transaction(FILE_STORE).objectStore(FILE_STORE).get(record.id)) as { blob?: Blob } | undefined
      total += stored?.blob?.size ?? 0
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

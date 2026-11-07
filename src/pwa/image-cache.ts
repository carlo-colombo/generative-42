import { signal } from '@preact/signals'
import { uploadBytes } from '../uploads'
import { imageCacheStats, online, storageEstimate, type ImageCacheStats, type StorageEstimate } from './update-state'

export const IMAGE_CACHE_NAME = 'images'
export const IMAGE_PATH_PREFIX = '/assets/'

const DB_NAME = 'gen42-pwa'
// Version 2 adds the shell build pointers that public/sw.js reads and writes.
// Both sides create the stores identically, so an upgrade from either wins.
const DB_VERSION = 2
const IMAGE_STORE = 'images'
const META_STORE = 'meta'
const MANIFEST_URL = '/assets/manifest.json'

const MEGABYTE = 1024 * 1024
const BUDGET_CAP = 512 * MEGABYTE
const BUDGET_SLACK = 20 * MEGABYTE
// The budget formula needs a quota; only used when storage.estimate() is missing.
const FALLBACK_QUOTA = 1024 * MEGABYTE
const HEAD_CONCURRENCY = 6

export type CachedImage = { path: string; bytes: number; lastUsed: number; sha: string }

export type ImageCacheProgress = {
  state: 'measuring' | 'downloading' | 'done'
  done: number
  total: number
  bytes: number
  totalBytes: number
  skipped: number
}

export const cachedImagePaths = signal<ReadonlySet<string>>(new Set())
export const builtInImageSizes = signal<Record<string, number>>({})
export const builtInImageTotal = signal<number | null>(null)
export const bulkProgress = signal<ImageCacheProgress | null>(null)

export function openPwaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE, { keyPath: 'path' })
      // Out-of-line keys: sw.js pins activeBuild, selectedBuild, previousBuild,
      // and lastReadyBuild as bare strings.
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the offline image store'))
    request.onblocked = () => reject(new Error('The offline image store is blocked by another tab'))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Offline image store request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Offline image store transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('Offline image store transaction aborted'))
  })
}

function withImageStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T | null> {
  return openPwaDb()
    .then(async (db) => {
      try {
        const tx = db.transaction(IMAGE_STORE, mode)
        const result = await run(tx.objectStore(IMAGE_STORE))
        await transactionDone(tx)
        return result
      } finally {
        db.close()
      }
    })
    .catch(() => null)
}

function readImageRecords(): Promise<CachedImage[] | null> {
  return withImageStore('readonly', (store) => requestResult(store.getAll()) as Promise<CachedImage[]>)
}

function writeImageRecord(record: CachedImage): Promise<unknown> {
  return withImageStore('readwrite', (store) => requestResult(store.put(record)))
}

function deleteImageRecord(path: string): Promise<unknown> {
  return withImageStore('readwrite', (store) => requestResult(store.delete(path)))
}

function clearImageRecords(): Promise<unknown> {
  return withImageStore('readwrite', (store) => requestResult(store.clear()))
}

async function openImageCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  try {
    return await caches.open(IMAGE_CACHE_NAME)
  } catch {
    return null
  }
}

async function readStorageEstimate(): Promise<StorageEstimate | null> {
  try {
    const manager = typeof navigator === 'undefined' ? undefined : navigator.storage
    if (!manager?.estimate) return null
    const estimate = await manager.estimate()
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}

export function budgetFromEstimate(estimate: StorageEstimate | null, uploadedBytes: number): number {
  const quota = estimate && estimate.quota > 0 ? estimate.quota : FALLBACK_QUOTA
  return Math.max(0, Math.floor(Math.min(BUDGET_CAP, quota * 0.5 - uploadedBytes - BUDGET_SLACK)))
}

export async function computeImageBudget(uploadedBytes: number): Promise<number> {
  return budgetFromEstimate(await readStorageEstimate(), uploadedBytes)
}

// Reports whether an image is really in the offline cache, including entries the
// worker stored but the page has not adopted into its records yet.
export async function isImageCached(path: string): Promise<boolean> {
  if (cachedImagePaths.value.has(path)) return true
  const cache = await openImageCache()
  if (!cache) return false
  // Cache.match resolves undefined (not null) on a miss.
  return Boolean(await cache.match(path).catch(() => null))
}

export function isBuiltInImagePath(ref: string): boolean {
  return ref.startsWith(IMAGE_PATH_PREFIX)
}

function saveDataEnabled(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return connection?.saveData === true
}

async function headSize(path: string): Promise<number | null> {
  try {
    const response = await fetch(path, { method: 'HEAD' })
    if (!response.ok) return null
    const length = Number(response.headers.get('content-length'))
    return Number.isFinite(length) && length > 0 ? length : null
  } catch {
    return null
  }
}

async function cachedImageBytes(cache: Cache, path: string): Promise<{ bytes: number; sha: string }> {
  try {
    const response = await cache.match(path)
    if (!response) return { bytes: 0, sha: '' }
    const blob = await response.blob()
    return { bytes: blob.size, sha: response.headers.get('etag') ?? '' }
  } catch {
    return { bytes: 0, sha: '' }
  }
}

function totalBytes(records: Iterable<CachedImage>): number {
  let bytes = 0
  for (const record of records) bytes += record.bytes
  return bytes
}

async function evictToBudget(records: CachedImage[], budget: number, reserve = 0): Promise<Map<string, CachedImage>> {
  const known = new Map(records.map((record) => [record.path, record]))
  let used = totalBytes(records)
  if (used + reserve <= budget) return known
  const cache = await openImageCache()
  for (const record of [...records].sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (used + reserve <= budget) break
    if (cache) await cache.delete(record.path).catch(() => false)
    await deleteImageRecord(record.path)
    known.delete(record.path)
    used -= record.bytes
  }
  return known
}

export async function refreshImageStates(): Promise<ImageCacheStats | null> {
  const estimate = await readStorageEstimate()
  storageEstimate.value = estimate
  const budget = budgetFromEstimate(estimate, await uploadBytes().catch(() => 0))
  const records = await readImageRecords()
  if (records === null) {
    cachedImagePaths.value = new Set()
    imageCacheStats.value = null
    return null
  }
  const known = new Map(records.map((record) => [record.path, record]))
  const cache = await openImageCache()
  if (cache) {
    const paths = new Set(
      (await cache.keys().catch(() => [])).map((request) => new URL(request.url).pathname),
    )
    // The service worker caches images the page only displayed, so adopt those
    // entries before reporting what is available offline.
    for (const path of paths) {
      if (known.has(path)) continue
      const { bytes, sha } = await cachedImageBytes(cache, path)
      const record = { path, bytes, lastUsed: Date.now(), sha }
      await writeImageRecord(record)
      known.set(path, record)
    }
    for (const record of records) {
      if (paths.has(record.path)) continue
      await deleteImageRecord(record.path)
      known.delete(record.path)
    }
  }
  // A zero budget evicts everything: the cache must never crowd out uploads.
  const kept = await evictToBudget([...known.values()], budget)
  const stats = { count: kept.size, bytes: totalBytes(kept.values()), budget }
  cachedImagePaths.value = new Set(kept.keys())
  imageCacheStats.value = stats
  return stats
}

async function touchImage(path: string): Promise<void> {
  const records = await readImageRecords()
  const record = records?.find((entry) => entry.path === path)
  if (!record) return
  await writeImageRecord({ ...record, lastUsed: Date.now() })
}

// Never rejects: callers treat a false return as "not cached" and a rejected
// promise would escape a fire-and-forget warm or wedge the bulk download.
export async function warmImage(path: string): Promise<boolean> {
  try {
    return await cacheImage(path)
  } catch (error) {
    console.error('Caching image failed', path, error)
    return false
  }
}

async function cacheImage(path: string): Promise<boolean> {
  if (!isBuiltInImagePath(path) || !online.value || saveDataEnabled()) return false
  if (cachedImagePaths.value.has(path)) {
    await touchImage(path)
    return true
  }
  const stats = await refreshImageStates()
  if (!stats || stats.budget <= 0) return false
  const size = builtInImageSizes.value[path] ?? (await headSize(path))
  if (size !== null && stats.bytes + size > stats.budget) return false
  let response: Response
  try {
    response = await fetch(path)
  } catch {
    return false
  }
  if (!response.ok) return false
  const bytes = await response.clone().blob().then((blob) => blob.size).catch(() => -1)
  if (bytes < 0 || bytes > stats.budget) return false
  const cache = await openImageCache()
  if (!cache) return false
  await evictToBudget((await readImageRecords()) ?? [], stats.budget, bytes)
  await cache.put(path, response)
  await writeImageRecord({ path, bytes, lastUsed: Date.now(), sha: response.headers.get('etag') ?? '' })
  await refreshImageStates()
  return true
}

async function manifestPaths(): Promise<string[]> {
  try {
    const response = await fetch(MANIFEST_URL)
    if (!response.ok) return []
    const files: unknown = await response.json()
    if (!Array.isArray(files)) return []
    return files
      .filter((file): file is string => typeof file === 'string')
      .map((file) => `${IMAGE_PATH_PREFIX}${file}`)
  } catch {
    return []
  }
}

async function forEachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      await run(item)
    }
  })
  await Promise.all(workers)
}

export async function loadBuiltInImageSizes(): Promise<void> {
  const paths = await manifestPaths()
  const sizes: Record<string, number> = {}
  await forEachLimited(paths, HEAD_CONCURRENCY, async (path) => {
    const size = builtInImageSizes.value[path] ?? (await headSize(path))
    if (size !== null) sizes[path] = size
  })
  builtInImageSizes.value = sizes
  // A partial total would understate what "all images" costs, so report none.
  builtInImageTotal.value = paths.length > 0 && paths.every((path) => sizes[path] !== undefined)
    ? paths.reduce((sum, path) => sum + sizes[path], 0)
    : null
}

function offlineTotals(paths: string[], sizes: Record<string, number>): { done: number; bytes: number } {
  let done = 0
  let bytes = 0
  for (const path of paths) {
    if (!cachedImagePaths.value.has(path)) continue
    done += 1
    bytes += sizes[path] ?? 0
  }
  return { done, bytes }
}

export async function makeAllImagesAvailableOffline(): Promise<void> {
  const running = bulkProgress.value
  if (!online.value || (running && running.state !== 'done')) return
  const paths = await manifestPaths()
  bulkProgress.value = { state: 'measuring', done: 0, total: paths.length, bytes: 0, totalBytes: 0, skipped: 0 }
  if (paths.length === 0) {
    bulkProgress.value = { state: 'done', done: 0, total: 0, bytes: 0, totalBytes: 0, skipped: 0 }
    return
  }
  const sizes = { ...builtInImageSizes.value }
  await forEachLimited(paths.filter((path) => sizes[path] === undefined), HEAD_CONCURRENCY, async (path) => {
    const size = await headSize(path)
    if (size !== null) sizes[path] = size
  })
  builtInImageSizes.value = sizes
  const totalBytes = paths.reduce((sum, path) => sum + (sizes[path] ?? 0), 0)
  builtInImageTotal.value = paths.every((path) => sizes[path] !== undefined) ? totalBytes : null
  let skipped = 0
  const report = (state: ImageCacheProgress['state']) => {
    bulkProgress.value = { state, ...offlineTotals(paths, sizes), total: paths.length, totalBytes, skipped }
  }
  try {
    report('downloading')
    await refreshImageStates()
    for (const path of paths) {
      if (!online.value) break
      if (cachedImagePaths.value.has(path)) continue
      const stats = imageCacheStats.value
      const size = sizes[path] ?? 0
      if (stats && size > 0 && stats.bytes + size > stats.budget) {
        skipped += 1
      } else if (!(await warmImage(path))) {
        // warmImage resolves false instead of rejecting: the image did not make
        // it into the cache, so the run is partial rather than broken.
        skipped += 1
      }
      report('downloading')
    }
  } catch (error) {
    console.error('Bulk image download failed', error)
  } finally {
    // The panel disables its buttons until it sees 'done', so this must run on
    // every path out of the loop.
    report('done')
  }
}

export async function clearOfflineImages(): Promise<void> {
  bulkProgress.value = null
  if (typeof caches !== 'undefined') await caches.delete(IMAGE_CACHE_NAME).catch(() => false)
  await clearImageRecords()
  await refreshImageStates()
}

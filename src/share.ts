import { signal } from '@preact/signals'

import { applyGeneration } from './generation-state'
import { appUrl } from './paths'
import { addUploads, keepUploadErrors, uploadRef } from './uploads'
import type { Generation } from './types'

// Android delivers a shared image as a multipart POST to the manifest's
// share_target action. public/sw.js parks the files in the shares cache and
// redirects here with ?share=<ids>; this module moves them into the upload
// store and makes the first one the source image. iOS is not a target: it has
// no share target support, so nothing here attempts a fallback.
const SHARE_CACHE = 'shares'
const SHARE_PARAM = 'share'
const SHARE_NONE = 'none'

export type ShareRequest = { kind: 'files'; ids: string[] } | { kind: 'none' }

// Shown in the Image section when a shared payload cannot become a source.
export const shareNotice = signal('')

// Android is the platform this targets (iOS has no share target and desktop
// share sheets are rare), so only Android is told about it.
export const shareHintVisible = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

function shareUrl(id: string): string {
  return appUrl(`/share/${encodeURIComponent(id)}`)
}

// Read once before getGeneration(): dropping the param leaves the landing URL
// describing the generation the app already had open, so the share replaces
// only the source image.
export function takeShareRequest(): ShareRequest | null {
  let url: URL
  try {
    url = new URL(window.location.href)
  } catch {
    return null
  }
  const raw = url.searchParams.get(SHARE_PARAM)
  if (raw === null) return null
  url.searchParams.delete(SHARE_PARAM)
  window.history.replaceState(window.history.state, '', url.toString())
  if (raw === SHARE_NONE) return { kind: 'none' }
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  return ids.length > 0 ? { kind: 'files', ids } : { kind: 'none' }
}

async function readShared(ids: string[]): Promise<File[]> {
  const cache = await caches.open(SHARE_CACHE)
  const files: File[] = []
  for (const id of ids) {
    const response = await cache.match(shareUrl(id))
    if (!response) continue
    const blob = await response.blob()
    let name = ''
    try {
      name = decodeURIComponent(response.headers.get('x-shared-name') ?? '')
    } catch {
      name = ''
    }
    files.push(new File([blob], name || 'shared image', { type: blob.type || 'application/octet-stream' }))
    await cache.delete(shareUrl(id))
  }
  return files
}

export async function importShare(request: ShareRequest, base: Generation): Promise<void> {
  if (request.kind === 'none') {
    shareNotice.value = 'Only images can be shared into the app.'
    return
  }
  let files: File[] = []
  try {
    files = await readShared(request.ids)
  } catch {
    files = []
  }
  if (files.length === 0) {
    shareNotice.value = 'The shared image could not be read. Try sharing it again.'
    return
  }
  const result = await addUploads(files)
  const first = result.added[0]
  if (!first) {
    shareNotice.value = result.errors.join(' · ') || 'The shared image could not be stored.'
    return
  }
  // The reload that commits the new image cannot show this load's notice.
  if (result.errors.length > 0) keepUploadErrors(result.errors.join(' · '))
  applyGeneration({ ...base, image: uploadRef(first.id) })
}

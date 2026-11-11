import { useEffect, useState } from 'preact/hooks'
import {
  bulkProgress,
  builtInImageTotal,
  clearOfflineImages,
  loadBuiltInImageSizes,
  makeAllImagesAvailableOffline,
  refreshImageStates,
} from '../pwa/image-cache'
import { acceptUpdate, checkForUpdates, rollbackToPrevious } from '../pwa/register'
import {
  buildId,
  canRollback,
  imageCacheStats,
  installPrompt,
  online,
  serviceWorkerState,
  storageEstimate,
  updateError,
  updateStatus,
  waitingBuildId,
} from '../pwa/update-state'
import { clearUploads, uploads } from '../uploads'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)))
}

function uploadLabel(count: number): string {
  return count === 1 ? '1 uploaded image' : `${count} uploaded images`
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function UpdatePanel() {
  const stats = imageCacheStats.value
  const estimate = storageEstimate.value
  const progress = bulkProgress.value
  const isOnline = online.value
  const total = builtInImageTotal.value
  const uploadCount = uploads.value.length
  const status = updateStatus.value
  const waiting = waitingBuildId.value
  const workerBuild = serviceWorkerState.value?.activeBuild
  const prompt = installPrompt.value
  const [message, setMessage] = useState('')
  const busy = progress?.state === 'measuring' || progress?.state === 'downloading'
  // The shell serving this page can lag the build the worker activated after a
  // rollback, so say which one renders.
  const servingPrevious = Boolean(workerBuild) && workerBuild !== buildId

  useEffect(() => {
    void refreshImageStates()
    if (isOnline) void loadBuiltInImageSizes()
  }, [isOnline])

  const makeAll = async () => {
    setMessage('')
    await makeAllImagesAvailableOffline()
    const result = bulkProgress.value
    if (!result) return
    if (result.total === 0) {
      setMessage('No built-in images to download.')
      return
    }
    if (result.done < result.total) {
      setMessage(`Saved ${result.done} of ${result.total} images; the rest could not be cached (budget or network).`)
      return
    }
    setMessage(`All ${result.total} built-in images are available offline.`)
  }

  const clearImages = async () => {
    setMessage('')
    await clearOfflineImages()
    setMessage('Offline images cleared.')
  }

  const clearAll = async () => {
    const confirmed = window.confirm(uploadCount > 0
      ? `Clear offline data? This deletes ${uploadLabel(uploadCount)} and the offline image cache. Presets and the current generation stay.`
      : 'Clear offline data? This deletes the offline image cache. Presets and the current generation stay.')
    if (!confirmed) return
    setMessage('')
    await clearOfflineImages()
    await clearUploads()
    await refreshImageStates()
    setMessage(uploadCount > 0 ? `Offline data cleared, including ${uploadLabel(uploadCount)}.` : 'Offline data cleared.')
  }

  const install = async () => {
    const event = installPrompt.value
    if (!event) return
    installPrompt.value = null
    await event.prompt()
  }

  const progressText = progress && progress.state !== 'measuring' && progress.total > 0
    ? `${progress.done}/${progress.total} images · ${formatBytes(progress.bytes)} of ${formatBytes(progress.totalBytes)}`
    : ''

  return <section className="panel-section" aria-labelledby="offline-title" data-update-status={status}>
    <h2 className="section-title" id="offline-title">Offline</h2>
    <div className="update-row">
      <span className="update-build">
        VERSION <span data-build-id={buildId}>v{buildId}</span>{servingPrevious ? ' · PREVIOUS' : ''}
      </span>
      <span
        className={isOnline ? 'connection-chip is-online' : 'connection-chip is-offline'}
        role="status"
        aria-live="polite"
        aria-label={isOnline ? 'Online' : 'Offline'}
      >{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
    </div>
    <button type="button" onClick={() => { void checkForUpdates() }} disabled={status === 'checking' || status === 'installing'}>
      {status === 'checking' ? 'CHECKING FOR UPDATES…' : 'CHECK FOR UPDATES'}
    </button>
    {status === 'ready' && <div className="update-block">
      <p className="hint-text" role="status">NEW VERSION AVAILABLE{waiting ? ` · v${waiting}` : ''}</p>
      <button type="button" onClick={() => { void acceptUpdate() }}>RELOAD</button>
    </div>}
    {status === 'installing' && <p className="hint-text" role="status">UPDATING…</p>}
    {status === 'error' && <p className="hint-text" role="status">{(updateError.value ?? 'Update failed.').toUpperCase()}</p>}
    {canRollback.value && <div className="update-block">
      <p className="hint-text" role="status">THIS BUILD HAS NOT RENDERED YET; YOUR PREVIOUS BUILD IS STILL ON THIS DEVICE</p>
      <button type="button" onClick={() => { void rollbackToPrevious() }}>GO BACK TO THE PREVIOUS VERSION</button>
    </div>}
    {prompt && <button type="button" onClick={() => { void install() }}>INSTALL APP</button>}
    {!prompt && isIos() && <p className="hint-text">
      INSTALL ON iOS: SHARE → ADD TO HOME SCREEN. INSTALLED APPS KEEP THEIR OWN STORAGE AND ARE NOT EVICTED AFTER 7 DAYS WITHOUT A VISIT.
    </p>}
    <div className="storage-rows">
      <div className="storage-row">
        <span className="storage-label">
          <span>Storage used</span>
          <span>{estimate ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}` : 'Unavailable'}</span>
        </span>
        <div className="storage-bar" role="img" aria-label="Storage usage">
          <div className="storage-bar-fill" style={{ width: `${percent(estimate?.usage ?? 0, estimate?.quota ?? 0)}%` }} />
        </div>
      </div>
      <div className="storage-row">
        <span className="storage-label">
          <span>Offline images</span>
          <span>{stats ? `${formatBytes(stats.bytes)} / ${formatBytes(stats.budget)} · ${stats.count}` : 'Unavailable'}</span>
        </span>
        <div className="storage-bar" role="img" aria-label="Offline image cache">
          <div className="storage-bar-fill" style={{ width: `${percent(stats?.bytes ?? 0, stats?.budget ?? 0)}%` }} />
        </div>
      </div>
    </div>
    <button type="button" onClick={() => { void makeAll() }} disabled={!isOnline || busy}>
      {busy
        ? 'Saving images for offline…'
        : `Make all images available offline${total !== null ? ` · ${formatBytes(total)}` : ''}`}
    </button>
    {progress?.state === 'measuring' && <p className="hint-text">Measuring image sizes…</p>}
    {progressText && <p className="hint-text">{progressText}</p>}
    <div className="add-row">
      <button type="button" onClick={() => { void clearImages() }} disabled={busy}>Clear offline images</button>
      <button type="button" onClick={() => { void clearAll() }} disabled={busy}>Clear offline data</button>
    </div>
    <p className="hint-text">
      {isOnline
        ? `Clearing offline data deletes ${uploadLabel(uploadCount)} and the cached images. Presets and the current generation stay.`
        : `Offline: only cached images and ${uploadLabel(uploadCount)} are available. Reconnect to download more.`}
    </p>
    {message && <p className="text-hint" role="status">{message}</p>}
  </section>
}

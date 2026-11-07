import {
  buildId,
  canRollback,
  serviceWorkerState,
  stageFailed,
  stageRendered,
  updateError,
  updateStatus,
  waitingBuildId,
  type ServiceWorkerState,
} from './update-state'
import { appUrl, BASE } from '../paths'

// A healthy build can take a long time to decode its image, fonts, and WASM, so
// the rollback offer waits for a terminal stage failure or for a render that is
// clearly never coming.
const ROLLBACK_TIMEOUT_MS = 15000
const ROLLBACK_ACK_MS = 2000
const STATE_REPLY_MS = 1000
const ACCEPT_FALLBACK_MS = 6000

let registration: ServiceWorkerRegistration | null = null
let rollbackTimer = 0
let accepting = false
let rollingBack = false
let reloaded = false

function serviceWorkerMode(): 'on' | 'off' {
  const flag = new URLSearchParams(location.search).get('sw')
  if (flag === '0') return 'off'
  if (flag === '1') return 'on'
  return import.meta.env.PROD ? 'on' : 'off'
}

function reloadOnce(): void {
  if (reloaded) return
  reloaded = true
  location.reload()
}

function queryState(worker: ServiceWorker | null): Promise<ServiceWorkerState | null> {
  if (!worker) return Promise.resolve(null)
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = window.setTimeout(() => resolve(null), STATE_REPLY_MS)
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer)
      resolve((event.data as ServiceWorkerState) ?? null)
    }
    worker.postMessage({ type: 'get-state' }, [channel.port2])
  })
}

function scheduleRollback(state: ServiceWorkerState): void {
  // Only the build the worker activated can be rolled back, and only while this
  // load has not rendered: a page that renders has nothing to go back from.
  const available = state.canRollback && state.buildId === buildId && !stageRendered.value
  window.clearTimeout(rollbackTimer)
  if (!available) {
    canRollback.value = false
    return
  }
  if (stageFailed.value) {
    canRollback.value = true
    return
  }
  rollbackTimer = window.setTimeout(() => {
    if (!stageRendered.value) canRollback.value = true
  }, ROLLBACK_TIMEOUT_MS)
}

async function refreshState(): Promise<void> {
  const state = await queryState(navigator.serviceWorker.controller)
  if (!state) return
  serviceWorkerState.value = state
  scheduleRollback(state)
}

// Uploads are the app's real local data: without a persist grant an eviction
// would delete user work, which is worse than losing a cache.
async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.()
  } catch {
    // A refused grant only weakens eviction protection.
  }
}

async function markWaiting(worker: ServiceWorker): Promise<void> {
  updateStatus.value = 'ready'
  const state = await queryState(worker)
  waitingBuildId.value = state?.buildId ?? null
}

function watchInstalling(worker: ServiceWorker): void {
  updateStatus.value = 'installing'
  updateError.value = null
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed') {
      updateError.value = null
      if (navigator.serviceWorker.controller) {
        void markWaiting(worker)
        return
      }
      // First install: the shell is now offline-capable but this page stays
      // network-served until the user opens the app again.
      updateStatus.value = 'idle'
      void requestPersistence()
      return
    }
    // A worker replaced by a newer one also goes redundant, but by then the
    // status has moved past 'installing'; only a failed precache dies here.
    if (worker.state === 'redundant' && updateStatus.value === 'installing') {
      updateError.value = 'The offline version could not be installed.'
      updateStatus.value = 'error'
    }
  })
}

function watchRegistration(next: ServiceWorkerRegistration): void {
  // A worker that finished installing during an earlier visit is still waiting
  // for this page to accept it.
  if (next.waiting && navigator.serviceWorker.controller) void markWaiting(next.waiting)
  next.addEventListener('updatefound', () => {
    const worker = next.installing
    if (worker) watchInstalling(worker)
  })
  // The browser discovered a new build by itself (navigating with /sw.js
  // no-cache): report it as installing rather than silently idling.
  if (next.installing) watchInstalling(next.installing)
}

export function notifyStageReady(): void {
  stageRendered.value = true
  stageFailed.value = false
  canRollback.value = false
  window.clearTimeout(rollbackTimer)
  navigator.serviceWorker?.controller?.postMessage({ type: 'stage-ready', buildId })
}

// A terminal stage status (WASM or image failure): this build will not render,
// so the rollback offer is due now rather than after the render timeout.
export function notifyStageFailed(): void {
  if (stageRendered.value) return
  stageFailed.value = true
  const state = serviceWorkerState.value
  if (state) scheduleRollback(state)
}

export async function acceptUpdate(): Promise<void> {
  if (accepting) return
  accepting = true
  const waiting = registration?.waiting
  if (!waiting) {
    reloadOnce()
    return
  }
  updateStatus.value = 'installing'
  updateError.value = null
  canRollback.value = false
  window.clearTimeout(rollbackTimer)
  waiting.postMessage({ type: 'skipWaiting' })
  // A worker that never activates would otherwise leave the button dead.
  window.setTimeout(reloadOnce, ACCEPT_FALLBACK_MS)
}

export async function rollbackToPrevious(): Promise<void> {
  if (rollingBack) return
  rollingBack = true
  updateStatus.value = 'installing'
  const reverted = await new Promise<boolean>((resolve) => {
    const worker = navigator.serviceWorker.controller
    if (!worker) {
      resolve(false)
      return
    }
    const channel = new MessageChannel()
    const timer = window.setTimeout(() => resolve(false), ROLLBACK_ACK_MS)
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer)
      resolve((event.data as { ok?: boolean } | null)?.ok === true)
    }
    worker.postMessage({ type: 'rollback' }, [channel.port2])
  })
  if (!reverted) {
    rollingBack = false
    canRollback.value = false
    updateError.value = 'The previous version could not be restored.'
    updateStatus.value = 'error'
    return
  }
  reloadOnce()
}

export async function checkForUpdates(): Promise<void> {
  if (!registration) return
  updateStatus.value = 'checking'
  updateError.value = null
  try {
    await registration.update()
    if (registration.waiting && navigator.serviceWorker.controller) {
      await markWaiting(registration.waiting)
      return
    }
    if (updateStatus.value === 'checking') updateStatus.value = 'idle'
  } catch (error) {
    console.error('Service worker update check failed', error)
    updateError.value = 'The update check failed.'
    updateStatus.value = 'error'
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (serviceWorkerMode() === 'off' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A first install does not claim clients, so only an accepted update or a
    // rollback reloads the page.
    if (accepting || rollingBack) reloadOnce()
  })
  try {
    const next = await navigator.serviceWorker.register(appUrl('/sw.js'), { scope: BASE })
    registration = next
    watchRegistration(next)
    await refreshState()
  } catch (error) {
    console.error('Service worker registration failed', error)
    updateError.value = 'The offline version could not be installed.'
    updateStatus.value = 'error'
  }
}

import { signal } from '@preact/signals'

export type UpdateStatus = 'idle' | 'checking' | 'installing' | 'ready' | 'error'

export type StorageEstimate = { usage: number; quota: number }

export type ImageCacheStats = { count: number; bytes: number; budget: number }

export type ServiceWorkerState = {
  buildId: string
  activeBuild: string | null
  previousBuild: string | null
  lastReadyBuild: string | null
  selectedBuild: string | null
  canRollback: boolean
}

type InstallPromptEvent = Event & { prompt(): Promise<void> }

export const buildId = __BUILD_ID__

export const updateStatus = signal<UpdateStatus>('idle')

// Set when a worker, an update check, or a rollback fails, so the panel can say
// what broke instead of only that something did.
export const updateError = signal<string | null>(null)

export const waitingBuildId = signal<string | null>(null)

export const canRollback = signal(false)

export const serviceWorkerState = signal<ServiceWorkerState | null>(null)

export const stageRendered = signal(false)

// The stage reached a terminal state: no retry will ever render this build, so a
// rollback offer does not have to wait out the render timeout.
export const stageFailed = signal(false)

export const installPrompt = signal<InstallPromptEvent | null>(null)

export const online = signal(navigator.onLine)

export const storageEstimate = signal<StorageEstimate | null>(null)

export const imageCacheStats = signal<ImageCacheStats | null>(null)

window.addEventListener('online', () => {
  online.value = true
})

window.addEventListener('offline', () => {
  online.value = false
})

// The event can arrive before the Offline panel mounts, so it is captured here
// and the default prompt is replayed by the panel's install button.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  installPrompt.value = event as InstallPromptEvent
})

window.addEventListener('appinstalled', () => {
  installPrompt.value = null
})

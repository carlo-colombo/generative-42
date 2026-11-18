import { hideToast, toast } from '../editor-state'

export function Toast() {
  const current = toast.value
  if (!current) return null
  return <div className="undo-toast" role="group" aria-label="Layer deletion">
    <span>{current.message}</span>
    <button type="button" onClick={() => {
      const action = current.action
      hideToast()
      action()
    }}>{current.actionLabel}</button>
    <button type="button" className="toast-close" aria-label="Dismiss" onClick={hideToast}>×</button>
  </div>
}

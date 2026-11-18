import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'

let nextHelpId = 0

export function HelpPopover({ label, children }: { label: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false)
  const id = useRef(`help-${nextHelpId++}`).current
  const wrapRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    popoverRef.current?.focus()
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const focusOut = (event: FocusEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      toggleRef.current?.focus()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key, true)
    document.addEventListener('focusin', focusOut)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key, true)
      document.removeEventListener('focusin', focusOut)
    }
  }, [open])

  return <div className="help" ref={wrapRef}>
    <button
      ref={toggleRef}
      type="button"
      className="help-toggle"
      aria-label={label}
      aria-expanded={open}
      aria-controls={id}
      title={label}
      onClick={() => setOpen(!open)}
    >?</button>
    {open && <div
      className="help-popover"
      id={id}
      ref={popoverRef}
      role="note"
      aria-label={label}
      tabIndex={-1}
    >{children}</div>}
  </div>
}

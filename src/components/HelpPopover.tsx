import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'

export function HelpPopover({ label, children }: { label: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false)
  return <div className="help">
    <button
      type="button"
      className="help-toggle"
      aria-label={label}
      aria-expanded={open}
      title={label}
      onClick={() => setOpen(!open)}
    >?</button>
    {open && <div className="help-popover" role="note">{children}</div>}
  </div>
}

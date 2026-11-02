import type { ComponentChildren } from 'preact'

export function ControlField({ label, value, children }: { label: string; value?: string | number; children: ComponentChildren }) {
  return <div className="control-field">
    <span className="control-label">
      <span>{label}</span>
      {value !== undefined && <span className="control-value">{value}</span>}
    </span>
    {children}
  </div>
}

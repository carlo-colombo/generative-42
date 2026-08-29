import type { ComponentChildren } from 'preact'

export function ControlField({ label, children }: { label: string; children: ComponentChildren }) {
  return <div className="control-field"><label>{label}</label>{children}</div>
}

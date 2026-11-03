import { ControlField } from './ControlField'

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (value: T) => void
}) {
  return <ControlField label={label}>
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => <button
        key={option.value}
        type="button"
        className={option.value === value ? 'active' : undefined}
        aria-pressed={option.value === value}
        title={option.title}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>)}
    </div>
  </ControlField>
}

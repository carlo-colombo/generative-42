import type { TextLayer } from '../types'
import { TextLayerActions } from './TextLayerActions'

type TextLayerListProps = {
  layers: TextLayer[]
  selectedIndex: number
  onSelect: (index: number) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onDuplicate?: (index: number) => void
  onRemove?: (index: number) => void
}

function previewOf(layer: TextLayer) {
  return layer.text.replace(/\s+/g, ' ').trim()
}

export function TextLayerList({ layers, selectedIndex, onSelect, onMoveUp, onMoveDown, onDuplicate, onRemove }: TextLayerListProps) {
  const reorder = (event: KeyboardEvent) => {
    if (!event.altKey) return
    const tagName = (event.target as HTMLElement).tagName
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return
    const row = (event.target as HTMLElement).closest<HTMLElement>('.layer-row')
    const index = row ? Number(row.dataset.index) : selectedIndex
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      onMoveUp(index)
    } else if (event.key === 'ArrowDown' && index < layers.length - 1) {
      event.preventDefault()
      onMoveDown(index)
    }
  }

  return <ul className="layer-list" onKeyDown={reorder}>
    {layers.map((layer, index) => {
      const preview = previewOf(layer)
      const selected = index === selectedIndex
      return <li key={index} className={`layer-row${selected ? ' selected' : ''}`} data-index={index}>
        <button type="button" className="layer-select" aria-pressed={selected} onClick={() => onSelect(index)}>
          <span className="layer-index">{index + 1}</span>
          <span className={`layer-preview${preview ? '' : ' is-empty'}`}>{preview || 'Empty'}</span>
          <span className="layer-opacity">{layer.opacity}%</span>
        </button>
        <TextLayerActions
          index={index}
          onMoveUp={index > 0 ? () => onMoveUp(index) : undefined}
          onMoveDown={index < layers.length - 1 ? () => onMoveDown(index) : undefined}
          onDuplicate={onDuplicate ? () => onDuplicate(index) : undefined}
          onRemove={onRemove ? () => onRemove(index) : undefined}
        />
      </li>
    })}
  </ul>
}

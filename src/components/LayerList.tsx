import { useEffect, useState } from 'preact/hooks'
import type { EditorModel } from '../editor-state'
import { duplicateLayer, moveLayer, removeLayer, updateLayer } from '../editor-state'
import { MAX_LAYERS, type GenerationModel } from '../generation-state'
import { effectLabel } from '../effects'
import type { Layer } from '../types'

function layerName(layer: Layer) {
  if (layer.kind === 'text') return layer.text.replace(/\s+/g, ' ').trim() || layer.label
  return layer.label || effectLabel(layer.effect)
}

function layerHint(layer: Layer) {
  if (layer.kind === 'text') return layer.label
  const arrow = layer.effect === 'pixel-sort' ? (layer.params.direction === 'vertical' ? ' ↕' : ' ↔') : ''
  return `${effectLabel(layer.effect)} · ${layer.shape.kind}${arrow}`
}

export function LayerList({ model, editor }: { model: GenerationModel; editor: EditorModel }) {
  const generation = model.draft.value
  const layers = generation.layers
  // Stored bottom-to-top; the list reads top-to-bottom like a layer stack.
  const display = [...layers].reverse()
  const selectedId = editor.selectedLayerId.value
  const atCapacity = layers.length >= MAX_LAYERS
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  useEffect(() => {
    if (!menuFor) return
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.layer-item')) setMenuFor(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuFor])

  const select = (id: string) => {
    setMenuFor(null)
    editor.selectedLayerId.value = id
  }

  const remove = (id: string, displayIndex: number) => {
    setMenuFor(null)
    removeLayer(model, id)
    if (editor.selectedLayerId.value === id) {
      const next = display[displayIndex + 1] ?? display[displayIndex - 1] ?? null
      editor.selectedLayerId.value = next?.id ?? null
    }
  }

  const duplicate = (id: string) => {
    const copy = duplicateLayer(model, id)
    if (copy) select(copy.id)
  }

  const moveBy = (displayIndex: number, offset: number) => {
    const target = displayIndex + offset
    if (target < 0 || target >= display.length) return
    moveLayer(model, display[displayIndex].id, layers.length - 1 - target)
  }

  const reorder = (fromDisplay: number, toDisplay: number) => {
    if (fromDisplay === toDisplay) return
    moveLayer(model, display[fromDisplay].id, layers.length - 1 - toDisplay)
  }

  return <section className="panel-section">
    <h2 className="section-title">Layers</h2>
    {display.length === 0
      ? <p className="hint-text">Empty stack: only the cropped source renders. Add an effect or a text layer.</p>
      : <ul className="layer-list">
        {display.map((layer, displayIndex) => {
          const solo = generation.soloLayerId === layer.id
          const name = layerName(layer)
          const selected = layer.id === selectedId
          const open = menuFor === layer.id
          const classes = [
            'layer-row',
            selected ? 'selected' : '',
            dragIndex === displayIndex ? 'dragging' : '',
            dropIndex === displayIndex && dragIndex !== null ? 'drop-target' : '',
          ].filter(Boolean).join(' ')
          return <li key={layer.id} className="layer-item">
            <div
              className={classes}
              onDragOver={(event) => {
                if (dragIndex === null) return
                event.preventDefault()
                setDropIndex(displayIndex)
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragIndex !== null) reorder(dragIndex, displayIndex)
                setDragIndex(null)
                setDropIndex(null)
              }}
            >
              <span
                className="layer-grip"
                draggable
                role="button"
                tabIndex={-1}
                aria-label={`Drag ${name}`}
                title="Drag to reorder"
                onDragStart={(event) => {
                  setDragIndex(displayIndex)
                  if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', layer.id)
                  }
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setDropIndex(null)
                }}
              >⠿</span>
              <button type="button" className="layer-select" aria-pressed={selected} onClick={() => select(layer.id)} title={name}>
                {layer.kind === 'effect'
                  ? <span className="layer-chip" style={{ background: layer.color }} />
                  : <span className="layer-chip layer-chip-text">T</span>}
                <span className="layer-copy">
                  <span className={`layer-preview${layer.kind === 'text' && !layer.text.trim() ? ' is-empty' : ''}`}>{name}</span>
                  <span className="layer-meta">
                    <span className="layer-kind">{layerHint(layer)}</span>
                    <span className="layer-opacity">{layer.opacity}%</span>
                    {solo && <span className="layer-solo" title="Solo">S</span>}
                  </span>
                </span>
              </button>
              <div className="layer-row-actions">
                <button
                  type="button"
                  className={layer.visible ? 'icon-button' : 'icon-button muted'}
                  aria-label={layer.visible ? `Hide ${name}` : `Show ${name}`}
                  aria-pressed={layer.visible}
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                  onClick={() => updateLayer(model, layer.id, (current) => ({ ...current, visible: !current.visible }))}
                >
                  {layer.visible ? '◉' : '◌'}
                </button>
                <button
                  type="button"
                  className={open ? 'icon-button active' : 'icon-button'}
                  aria-label={`More actions for ${name}`}
                  aria-expanded={open}
                  aria-controls={`layer-menu-${layer.id}`}
                  title="More actions"
                  onClick={() => setMenuFor(open ? null : layer.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setMenuFor(null)
                  }}
                >
                  ⋯
                </button>
              </div>
            </div>
            {open && <div className="layer-menu" id={`layer-menu-${layer.id}`} onKeyDown={(event) => {
              if (event.key === 'Escape') setMenuFor(null)
            }}>
              <button type="button" onClick={() => {
                setMenuFor(null)
                model.setField('soloLayerId', solo ? '' : layer.id)
              }}>
                <span className="layer-menu-icon" aria-hidden="true">S</span>{solo ? 'Stop solo' : 'Solo'}
              </button>
              <button type="button" disabled={atCapacity} onClick={() => {
                setMenuFor(null)
                duplicate(layer.id)
              }}>
                <span className="layer-menu-icon" aria-hidden="true">⧉</span>Duplicate
              </button>
              <button type="button" disabled={displayIndex === 0} onClick={() => {
                setMenuFor(null)
                moveBy(displayIndex, -1)
              }}>
                <span className="layer-menu-icon" aria-hidden="true">↑</span>Move up
              </button>
              <button type="button" disabled={displayIndex === display.length - 1} onClick={() => {
                setMenuFor(null)
                moveBy(displayIndex, 1)
              }}>
                <span className="layer-menu-icon" aria-hidden="true">↓</span>Move down
              </button>
              <button type="button" className="danger" onClick={() => remove(layer.id, displayIndex)}>
                <span className="layer-menu-icon" aria-hidden="true">✕</span>Delete
              </button>
            </div>}
          </li>
        })}
      </ul>}
    <p className="hint-text">The top row renders last, over the rows below it. Drag the grip to reorder; ⋯ holds the other actions. The cropped source is the background.</p>
  </section>
}

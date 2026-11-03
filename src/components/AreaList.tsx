import type { EditorModel } from '../editor-state'
import { duplicateArea, moveArea, removeArea, updateArea } from '../editor-state'
import { MAX_AREAS, type GenerationModel } from '../generation-state'

export function AreaList({ model, editor }: { model: GenerationModel; editor: EditorModel }) {
  const generation = model.draft.value
  const areas = generation.areas
  const selectedId = editor.selectedId.value
  const atCapacity = areas.length >= MAX_AREAS

  return <section className="panel-section">
    <h2 className="section-title">Areas</h2>
    {areas.length === 0
      ? <p className="hint-text">No areas yet. Pick a shape tool and draw on the stage.</p>
      : <div className="area-list">
        {areas.map((area, index) => {
          const solo = generation.soloAreaId === area.id
          const name = area.label || `Area ${index + 1}`
          return <div className={area.id === selectedId ? 'area-row selected' : 'area-row'} key={area.id}>
            <button type="button" className="area-row-main" onClick={() => { editor.selectedId.value = area.id }} title={area.label || area.id}>
              <span className="area-chip" style={{ background: area.color }} />
              <span className="area-row-name">{area.label || area.id}</span>
              <span className="direction-glyph" title={area.sort.direction}>{area.sort.direction === 'horizontal' ? '↔' : '↕'}</span>
            </button>
            <div className="area-row-actions">
              <button
                type="button"
                className={area.visible ? 'icon-button' : 'icon-button muted'}
                aria-label={area.visible ? `Hide ${name}` : `Show ${name}`}
                aria-pressed={area.visible}
                title={area.visible ? 'Hide area' : 'Show area'}
                onClick={() => updateArea(model, area.id, (current) => ({ ...current, visible: !current.visible }))}
              >
                {area.visible ? '◉' : '◌'}
              </button>
              <button
                type="button"
                className={solo ? 'icon-button active' : 'icon-button'}
                aria-label={`Solo ${name}`}
                aria-pressed={solo}
                title="Solo"
                onClick={() => model.setField('soloAreaId', solo ? '' : area.id)}
              >
                S
              </button>
              <button type="button" className="icon-button" aria-label={`Duplicate ${name}`} title="Duplicate" disabled={atCapacity} onClick={() => {
                const copy = duplicateArea(model, area.id)
                if (copy) editor.selectedId.value = copy.id
              }}>
                ⧉
              </button>
              <button type="button" className="icon-button" aria-label={`Move ${name} up`} title="Move up" disabled={index === 0} onClick={() => moveArea(model, area.id, -1)}>↑</button>
              <button type="button" className="icon-button" aria-label={`Move ${name} down`} title="Move down" disabled={index === areas.length - 1} onClick={() => moveArea(model, area.id, 1)}>↓</button>
              <button type="button" className="icon-button" aria-label={`Delete ${name}`} title="Delete" onClick={() => {
                removeArea(model, area.id)
                if (editor.selectedId.value === area.id) editor.selectedId.value = null
              }}>
                ✕
              </button>
            </div>
          </div>
        })}
      </div>}
    <p className="hint-text">Rows composite in list order; later rows render on top.</p>
  </section>
}

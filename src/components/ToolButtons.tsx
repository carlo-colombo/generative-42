import type { EditorModel, ShapeTool } from '../editor-state'
import { MAX_LAYERS, type GenerationModel } from '../generation-state'

type ToolDefinition = { id: ShapeTool; label: string; hint: string }

export const SHAPE_TOOLS: ToolDefinition[] = [
  { id: 'select', label: 'Select', hint: 'Drag a shape to move · drag a handle to resize · alt-click a vertex to delete or an edge to insert · arrows nudge' },
  { id: 'rect', label: 'Rect', hint: 'Drag to draw a rectangle layer' },
  { id: 'ellipse', label: 'Ellipse', hint: 'Drag to draw an ellipse layer · hold shift for a circle' },
  { id: 'polygon', label: 'Polygon', hint: 'Click to add points · Enter or double click closes · Backspace removes the last point · Esc cancels' },
  { id: 'lasso', label: 'Lasso', hint: 'Drag a freehand outline · simplified on release' },
  { id: 'curve', label: 'Curve', hint: 'Drag an open stroke · then choose side A or B' },
]

export function ToolButtons({ editor, disabled = false }: { editor: EditorModel; disabled?: boolean }) {
  const tool = editor.tool.value
  return <div className="tool-buttons" role="toolbar" aria-label="Shape tools">
    {SHAPE_TOOLS.map((entry) => (
      <button
        key={entry.id}
        type="button"
        className={entry.id === tool ? 'tool-button active' : 'tool-button'}
        aria-pressed={entry.id === tool}
        title={entry.hint}
        disabled={disabled && entry.id !== 'select'}
        onClick={() => { editor.tool.value = entry.id }}
      >
        {entry.label}
      </button>
    ))}
  </div>
}

export function StageToolbar({ editor, model }: { editor: EditorModel; model: GenerationModel }) {
  const active = SHAPE_TOOLS.find((entry) => entry.id === editor.tool.value)
  const atCapacity = model.draft.value.layers.length >= MAX_LAYERS
  return <div className="stage-toolbar">
    <ToolButtons editor={editor} disabled={atCapacity} />
    <button
      type="button"
      className={editor.showMasks.value ? 'tool-button active' : 'tool-button'}
      aria-pressed={editor.showMasks.value}
      title={editor.showMasks.value ? 'Hide the layer outlines and stop editing the stage' : 'Show the layer outlines and edit on the stage'}
      onClick={() => { editor.showMasks.value = !editor.showMasks.value }}
    >
      {editor.showMasks.value ? 'Masks on' : 'Masks off'}
    </button>
    <span className="toolbar-hint">{atCapacity ? `Limit of ${MAX_LAYERS} layers` : active?.hint}</span>
  </div>
}

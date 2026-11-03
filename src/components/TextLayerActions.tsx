type TextLayerActionsProps = {
  index: number
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDuplicate?: () => void
  onRemove?: () => void
}

export function TextLayerActions({ index, onMoveUp, onMoveDown, onDuplicate, onRemove }: TextLayerActionsProps) {
  const label = `layer ${index + 1}`
  return <div className="layer-actions">
    <button type="button" className="compact-button" aria-label={`Move ${label} up`} disabled={!onMoveUp} onClick={onMoveUp}>↑</button>
    <button type="button" className="compact-button" aria-label={`Move ${label} down`} disabled={!onMoveDown} onClick={onMoveDown}>↓</button>
    <button type="button" className="compact-button" aria-label={`Duplicate ${label}`} disabled={!onDuplicate} onClick={onDuplicate}>⧉</button>
    <button type="button" className="compact-button" aria-label={`Remove ${label}`} disabled={!onRemove} onClick={onRemove}>✕</button>
  </div>
}

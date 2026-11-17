import type { EditorModel, MobileTab } from '../editor-state'

export function MobileTabs({ editor }: { editor: EditorModel }) {
  const tab = editor.mobileTab.value
  const choose = (next: MobileTab) => {
    if (tab === next) return
    editor.mobileTab.value = next
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }
  return <div className="mobile-tabs" role="group" aria-label="Panels">
    <button type="button" className={tab === 'image' ? 'active' : ''} aria-pressed={tab === 'image'} onClick={() => choose('image')}>Image</button>
    <button type="button" className={tab === 'layers' ? 'active' : ''} aria-pressed={tab === 'layers'} onClick={() => choose('layers')}>Layers</button>
  </div>
}

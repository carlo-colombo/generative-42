# TODO

## Backlog

### Tooling

- [ ] Remove all headless generation infrastructure:
  - delete `generate/headless.ts` and the `generate/` directory
  - drop the `generate` and `generate:all` scripts from `package.json`
  - remove `puppeteer` and update `pnpm-lock.yaml`
  - delete the `output/` artifacts and its ignore entry
  - drop `PUPPETEER_SKIP_DOWNLOAD` from `.github/workflows/deploy.yml`
  - remove the `canvas.base-layer.dataset.composed` capture flag and the headless-capture references in `AGENTS.md`, `src/stage.ts`, and `generate/headless.ts`
  - re-check the `?sw=0` rationale once the headless script is gone

### UX review follow-ups

- [ ] Undo toast for layer deletes; undo or two-step confirm for upload/preset deletes
- [x] Commit Generate/Next/seed edits in place; Generate picks a new random seed
- [ ] Swap the source image in place (image select and share still reload)
- [ ] Copy-link / Web Share for the current generation
- [ ] Stage empty state with Upload, sample, drag-and-drop and paste; split offline vs missing-upload errors
- [ ] Focus and target-size pass (24 px minimum, 44 px on touch)
- [ ] Right-panel IA: layer-list scroll, sticky inspector, collapse the Offline panel, mobile tabs
- [ ] Seed/layer label collision and contrast
- [ ] Canvas semantics and help-popover dismissal
- [ ] Accessibility pass (landmarks, announcements, headings) and validation

# TODO

## Backlog

### Tooling

- [x] Remove all headless generation infrastructure:
  - [x] delete `generate/headless.ts` and the `generate/` directory
  - [x] drop the `generate` and `generate:all` scripts from `package.json`
  - [x] remove `puppeteer` and update `pnpm-lock.yaml`
  - [x] delete the `output/` artifacts and its ignore entry
  - [x] drop `PUPPETEER_SKIP_DOWNLOAD` from `.github/workflows/deploy.yml`
  - [x] remove the `canvas.base-layer.dataset.composed` capture flag and the headless-capture references in `AGENTS.md`, `src/stage.ts`, and `generate/headless.ts`
  - [x] re-check the `?sw=0` rationale once the headless script is gone

### UX review follow-ups

- [x] Undo toast for layer deletes; two-step confirm for upload/preset deletes
- [x] Commit Generate/Next/seed edits in place; Generate picks a new random seed
- [x] Swap the source image in place (first upload, selects, drop/paste and share commit without reloading)
- [x] Copy-link / Web Share for the current generation
- [x] Make shared links portable: Web Share sends the PNG when files are supported; Download PNG otherwise
- [x] Stage empty state with Upload, sample, drag-and-drop and paste; split offline vs missing-upload errors
- [x] Focus rings and 24 px desktop targets (20 px layer icons use the 4 px spacing exception)
- [x] 44 px touch targets for layer, upload, footer, form and help controls (layer overflow menu)
- [x] Mobile Image/Layers tabs with the stage and tabs sticky; footer no longer overlays the panel
- [x] Collapse the Offline panel and keep the inspector reachable in long stacks
- [x] Seed/layer label collision and contrast
- [x] Canvas semantics and help-popover dismissal
- [x] Landmarks, heading hierarchy, announcements and help-popover keyboard handling
- [x] Axe 4.10.2 clean on desktop and both mobile tabs; 44 px form/checkbox targets

# Family Tree

A private, local-first family tree and memory app. Map how your family
connects — parents, children, spouses, remarriage, adoption, step-family —
and eventually attach the photos, stories, and events that go with each
person.

Everything lives in your browser. No accounts, no server, no tracking.

## Technology stack

- [Vite](https://vite.dev/) + [React](https://react.dev/) + TypeScript (strict mode)
- [Dexie](https://dexie.org/) over IndexedDB for local persistence
- No backend, no authentication, no cloud sync (by design, for now)

## Local development

```bash
npm install
npm run dev
```

Other commands:

```bash
npm run build     # type-check and produce a production build in dist/
npm run preview   # serve the production build locally
```

## Deployment

Deployed to **GitHub Pages** via GitHub Actions
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)): every push to
`main` builds the app and publishes `dist/` automatically. `vite.config.ts`
sets `base: '/FamilyTree/'` to match this repository's Pages URL
(`https://<username>.github.io/FamilyTree/`).

To enable Pages on GitHub: **Settings → Pages → Source → GitHub Actions**.

## Architecture

- **Data model** — five entities: `FamilyTree`, `Person`, `ParentLink`,
  `Union`, `MediaRecord`. Every tree, person, and relationship belongs to a
  `FamilyTree`, so multiple trees (paternal side, maternal side, a partner's
  family) are supported from day one.
- **Relationships as a graph, not a strict tree** — `ParentLink` (a
  parent → child edge, typed biological/adopted/step/foster) and `Union` (a
  partnership edge, typed married/partnered/divorced/etc.) are the only
  stored relationship records. Siblings, half-siblings, and most
  step-relationships are *derived* from those edges rather than stored, so
  there's nothing to keep in sync or let go stale.
- **Storage** — `src/lib/storage/` wraps Dexie/IndexedDB behind one module
  per entity (`familyTrees.ts`, `people.ts`, `relationships.ts`, `media.ts`).
  Nothing outside that folder talks to Dexie directly, which keeps future
  changes (schema migrations, cloud sync) isolated from the rest of the app.
- **Media stays separate** — `Person` never embeds binary data; it only
  holds a `profilePhotoId` pointing at a `MediaRecord`. Keeps the core
  records small and portable, and leaves room for photos/audio/video later
  without a rewrite.

## Current status: Phase 1 — Foundation

- [x] Project scaffold, strict TypeScript, GitHub Pages build/deploy pipeline
- [x] Full data model and IndexedDB storage layer for all five entities
- [x] Create a `FamilyTree`; the app remembers and reopens the active one
- [ ] Person and relationship management UI
- [ ] Interactive tree visualization
- [ ] Memories (photos, stories, events)
- [ ] Import/export
- [ ] Optional cloud sync (future)

## Planned phases

1. **Foundation** *(current)* — project setup, data model, storage layer, active-tree UI
2. **People** — add/edit people within a tree
3. **Relationships** — connect people via parent links and unions
4. **Visualization** — the interactive, explorable family tree canvas
5. **Memories** — photos, stories, voice recordings, and events attached to people
6. **Import/export** — portable JSON backup and restore
7. **Future** — optional cloud sync, face-tagging assist

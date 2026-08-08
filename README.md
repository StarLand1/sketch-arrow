# Sketch Arrow

Sketch Arrow is a local-first Figma Design plugin that generates editable, hand-drawn arrows without stretching fixed assets.

## Free and Pro features

- Free: generate from one Figma `LineNode` or two layers, choose Natural or
  Hand-drawn loop, edit color and stroke width, and reverse direction.
- Pro: adjust head size, curve direction, and hand-drawn feel; choose Ink,
  Pencil, or Highlighter brushes; choose additional head styles; and use
  S-curve, Spiral, Wave, or Emphasis paths.
- Pro also includes local presets and brand-color swatches. These values stay
  in Figma `clientStorage` and are never uploaded.
- Every generated arrow is deterministic for its saved seed and remains
  editable as separate guide, shaft, accent, and head VectorNodes.
- Bilingual Chinese/English UI with light and dark theme support.
- Figma Payments is used for Pro entitlement when the published plugin is
  eligible. No account system, analytics, backend, or external network calls
  are used.

## Local development

Requirements: Node.js 20+ and the Figma desktop app.

```bash
npm install
npm run dev
```

In Figma desktop:

1. Open **Plugins → Development → Import plugin from manifest…**.
2. Choose this repository's `manifest.json`.
3. Run **Sketch Arrow** from the Development plugins menu.

`npm run dev` watches `src/` and rebuilds `dist/code.js` and the single-file `dist/ui.html`.

## Verification

```bash
npm run check
```

This runs TypeScript validation, geometry unit tests, and a minified production build.

## How to use

### From a line

1. Press `L` in Figma and draw a line from the desired start to end.
2. Select the line and run Sketch Arrow.
3. Adjust the controls and click **Generate arrow**.

The original line becomes a hidden guide inside the generated group. Expand the group and reveal the guide if you want to inspect it.

### Between two layers

1. Select exactly two layers.
2. Run Sketch Arrow and click **Generate arrow**.

The plugin connects the facing boundaries. If the layers overlap or are too close, use a Line guide instead.

### Update an arrow

Select the `Sketch Arrow` group, change controls, then click **Update arrow**.
Updates keep the saved hand-drawn seed, so the shape does not unexpectedly
change while you tune a free control. The original source Line or source layer
IDs are retained for future updates; if a source is deleted, the current arrow
remains editable but cannot be regenerated from that source.

## Architecture

- `src/core/geometry.ts`: pure geometry, transform, connection, curve, and arrowhead algorithms.
- `src/plugin/controller.ts`: Figma selection, nodes, grouping, metadata, persistence, and error handling.
- `src/ui/`: React iframe UI and bilingual copy.
- `src/core/entitlements.ts`: free entitlement provider and Figma Payments
  checkout seam.

The arrow shaft uses [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand) (MIT) to turn the generated centerline into a pressure-sensitive filled vector outline. This gives the stroke an intentional light-to-full transition while keeping the arrow end full and rounded, without relying on Figma's renderer-specific variable stroke support.

Generated groups store versioned private plugin metadata under `sketch-arrow:metadata`. Future metadata formats should add migrations rather than rewriting existing arrows in place.

## Publishing checklist

Before publishing to Figma Community:

1. Create/register the plugin in Figma and replace the placeholder `manifest.json` ID (`000000000000000000`) with the assigned numeric Plugin ID.
2. Confirm the final product name and support contact.
3. Prepare the icon, cover, screenshots, Community description, and privacy disclosure.
4. Confirm the commercial terms and Pro feature list.
5. Re-run `npm run check` and the manual scenarios below.

The manifest requests the Figma `payments` permission. In a local development
manifest or an unsupported runtime, the plugin safely remains in Free mode.
The payment implementation is isolated in `src/core/entitlements.ts`, so the
geometry and document model do not depend on a server or user account.

## Manual QA matrix

- Horizontal, vertical, diagonal, reversed, rotated, and nested Lines.
- 40px, 220px, 800px, and 1600px distances.
- Two layers arranged horizontally, vertically, diagonally, rotated, and in Auto Layout.
- Layers in the same poster Frame and layers across top-level Frames.
- Move or delete source layers, then update.
- Natural/Loop, all Pro paths, brush/head variants, curvature extremes,
  roughness extremes, and head-size extremes (in a paid test environment).
- Light/dark themes and Chinese/English UI.
- Reopen the plugin and confirm the last settings persist.

## Current boundaries

- Figma Design only.
- Arbitrary custom Pen/Pencil path import is planned for a later release;
  the built-in advanced path templates are available in Pro.
- Arrows do not update in the background; Figma plugins cannot stay running after they are closed.
- Two-layer connection uses oriented rectangular bounds for predictable performance.

# Sketch Arrow

Sketch Arrow is a local-first Figma Design plugin that generates editable, hand-drawn arrows without stretching fixed assets. Version 0.2.0 is fully free: every built-in generation mode, visual style, and local preset feature is available without an account, payment, or network service.

## Features

- Generate from one Figma `LineNode` or automatically connect two selected layers.
- Choose Natural, Hand-drawn loop, S-curve, or Wave paths.
- Choose Clean, Sketch, or Double-drawn line character.
- Choose Solid, Hollow, or Path arrow heads.
- Choose Solid, Dashed, or Dotted stroke patterns.
- Choose Thin, Medium, or Bold widths, three head sizes, common or custom colors, and reverse direction.
- Save, apply, overwrite, rename, and delete local presets. Presets store the complete visual combination in Figma `clientStorage` and are never uploaded.
- Every generated arrow is deterministic for its saved seed and remains editable as separate guide, shaft, and head VectorNodes.
- Dashed and dotted lines are arc-length-split filled vectors, not renderer-dependent stroke dash patterns.
- Bilingual Chinese/English UI with light and dark theme support.
- No account system, analytics, backend, payment flow, or external network calls.

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
3. Click any path, color, width, size, line, or head setting. The arrow is
   generated immediately with the complete current combination.

The original line becomes a hidden guide inside the generated group. Expand the group and reveal the guide if you want to inspect it.

### Presets

1. After configuring an arrow, open the **Presets** section and choose **Save current preset**.
2. Give the preset a name. Its path shape, color, width, head size, line
   pattern, line character, and head style are stored together.
3. Choose a saved preset from the selector to apply it to the current Line,
   two-layer selection, or selected Sketch Arrow. Direction is intentionally
   kept from the current selection rather than stored in the preset.
4. Click **Manage** to expand the management panel, then use **Overwrite**,
   **Rename**, or **Delete** on a saved preset.

### Between two layers

1. Select exactly two layers.
2. Run Sketch Arrow and click any setting to generate the connection.

The plugin connects the facing boundaries. If the layers overlap or are too close, use a Line guide instead.

### Update an arrow

Select the `Sketch Arrow` group and click any setting. The selected arrow is
updated in place instead of creating a duplicate. Updates keep the saved seed;
only **Rerandomize** replaces it. The original source Line or source layer IDs
are retained for future updates; if a source is deleted, the current arrow
remains editable but cannot be regenerated from that source.

Arrows and presets created by the previous commercial build remain compatible. The free build keeps their stored visual settings and does not reset or downgrade them.

## Architecture

- `src/core/geometry.ts`: pure geometry, transform, connection, curve, and arrowhead algorithms.
- `src/plugin/controller.ts`: Figma selection, nodes, grouping, metadata, persistence, and error handling.
- `src/ui/`: React iframe UI and bilingual copy.

The arrow shaft uses [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand) (MIT) to turn the generated centerline into a pressure-sensitive filled vector outline. This gives the stroke an intentional light-to-full transition while keeping the arrow end full and rounded, without relying on Figma's renderer-specific variable stroke support.

Generated groups store versioned private plugin metadata under `sketch-arrow:metadata`. Existing V5 metadata, including the legacy commercial trial marker, remains readable for compatibility; the free build does not use that marker for authorization.

## Publishing checklist

Before publishing to Figma Community:

1. Create/register the plugin in Figma and replace the placeholder `manifest.json` ID (`000000000000000000`) with the assigned numeric Plugin ID.
2. Confirm the final product name and support contact.
3. Prepare the icon, cover, screenshots, Community description, and privacy disclosure.
4. Re-run `npm run check` and the manual scenarios below.

The local development manifest does not request the Figma Payments permission. The plugin keeps all functionality available in local development and published builds.

## Manual QA matrix

- Horizontal, vertical, diagonal, reversed, rotated, and nested Lines.
- 40px, 220px, 800px, and 1600px distances.
- Two layers arranged horizontally, vertically, diagonally, rotated, and in Auto Layout.
- Layers in the same poster Frame and layers across top-level Frames.
- Move or delete source layers, then update.
- Natural/Loop, S-curve/Wave paths, three line characters, three head styles,
  solid/dashed/dotted patterns, three widths, common/custom colors, and three
  head sizes.
- Save, apply, overwrite, rename, and delete presets containing advanced visual settings.
- Confirm the default Medium head is 120% of the old default, Hollow has even
  wall thickness, dash gaps are about 70% of a dash, and Double-drawn creates
  two visibly distinct but related passes.
- Confirm the first setting click creates an arrow and later setting clicks
  update that selected arrow without duplicates.
- Select commercial-build arrows and presets, then verify their advanced settings remain available and editable.
- Light/dark themes and Chinese/English UI.
- Reopen the plugin and confirm the last settings persist.

## Current boundaries

- Figma Design only.
- Arbitrary custom Pen/Pencil path import is planned for a later release;
  the built-in S-curve and Wave templates are available for free.
- Arrows do not update in the background; Figma plugins cannot stay running after they are closed.
- Two-layer connection uses oriented rectangular bounds for predictable performance.

# Sketch Arrow

Sketch Arrow is a local-first Figma Design plugin that generates editable, hand-drawn arrows without stretching fixed assets.

## Free and Pro features

- Free: generate from one Figma `LineNode`, choose Natural or Hand-drawn loop,
  choose Thin/Medium/Bold widths and Small/Medium/Large solid heads, use common
  or custom colors, reverse direction, and rerandomize the saved gesture.
- Pro: automatically connect two selected layers, choose Hollow or Path heads,
  dashed or dotted patterns, Sketch or Double-drawn line character, and S-curve
  or Wave paths.
- Before purchase, an unpaid user receives five Pro arrow slots. A slot is
  claimed only when an arrow first uses a Pro capability; continued edits to
  that same trial arrow do not consume another slot.
- Pro is designed as a one-time purchase. Configure the actual price and
  one-time payment model in the Figma Community publishing flow.
- Pro also includes a local preset library. Presets save the complete visual
  combination, including path color, and stay in Figma `clientStorage`; they
  are never uploaded.
- Every generated arrow is deterministic for its saved seed and remains
  editable as separate guide, shaft, and head VectorNodes. Dashed and
  dotted lines are arc-length-split filled vectors, not renderer-dependent
  stroke dash patterns.
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
3. Click any path, color, width, size, line, or head setting. The arrow is
   generated immediately with the complete current combination.

The original line becomes a hidden guide inside the generated group. Expand the group and reveal the guide if you want to inspect it.

### Presets

1. After configuring an arrow, open the **Presets** section and choose
   **Save current preset** beside the preset selector.
2. Give the preset a name. Its path shape, color, width, head size, line
   pattern, line character, and head style are stored together.
3. Choose a saved preset from the selector to apply it to the current Line,
   two-layer selection, or selected Sketch Arrow. Direction is intentionally
   kept from the current selection rather than stored in the preset.
4. Click **Manage** to expand the management panel, then use **Overwrite**,
   **Rename**, or **Delete** on a saved preset.

Preset storage is a Pro capability. Existing old-version brand-color data is
ignored by the new UI; common colors and the custom color picker remain free.

### Between two layers

1. Select exactly two layers.
2. Run Sketch Arrow and click any setting to generate the connection. This is
   a Pro capability and can use one of the five trial arrow slots before
   purchase.

The plugin connects the facing boundaries. If the layers overlap or are too close, use a Line guide instead.

### Update an arrow

Select the `Sketch Arrow` group and click any setting. The selected arrow is
updated in place instead of creating a duplicate. Updates keep the saved seed;
only **Rerandomize** replaces it. The original source Line or source layer IDs
are retained for future updates; if a source is deleted, the current arrow
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
4. Configure a one-time payment price, then confirm the commercial terms and
   Pro feature list.
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
- Natural/Loop, S-curve/Wave Pro paths, three line characters, three head styles,
  solid/dashed/dotted patterns, three widths, common/custom colors, and three
  head sizes.
- Five Pro trial arrow slots: the first use of a Pro capability on an arrow
  decrements the count once; repeated updates to that same trial arrow do not
  decrement it. Verify the sixth Pro arrow opens the purchase prompt.
- Confirm the default Medium head is 120% of the old default, Hollow has even
  wall thickness, dash gaps are about 70% of a dash, and Double-drawn creates
  two visibly distinct but related passes.
- Confirm the first setting click creates an arrow and later setting clicks
  update that selected arrow without duplicates.
- Light/dark themes and Chinese/English UI.
- Reopen the plugin and confirm the last settings persist.

## Current boundaries

- Figma Design only.
- Arbitrary custom Pen/Pencil path import is planned for a later release;
  the built-in S-curve and Wave templates are available in Pro.
- Arrows do not update in the background; Figma plugins cannot stay running after they are closed.
- Two-layer connection uses oriented rectangular bounds for predictable performance.

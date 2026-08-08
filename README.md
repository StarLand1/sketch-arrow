# Sketch Arrow

Sketch Arrow is a local-first Figma Design plugin that generates editable, hand-drawn arrows without stretching fixed assets.

## MVP features

- Generate from one Figma `LineNode`.
- Connect exactly two selected layers at their facing boundaries.
- Natural and loop styles with deterministic hand-drawn variation.
- Edit color, stroke width, arrowhead size, curvature, roughness, and direction.
- Update, reverse, or reroll a generated arrow.
- Bilingual Chinese/English UI with light and dark theme support.
- No network requests, analytics, account, or backend.

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

Select the `Sketch Arrow` group, change controls, then click **Update arrow**. **Reroll** changes only the seeded hand-drawn variation; regular updates remain deterministic.

## Architecture

- `src/core/geometry.ts`: pure geometry, transform, connection, curve, and arrowhead algorithms.
- `src/plugin/controller.ts`: Figma selection, nodes, grouping, metadata, persistence, and error handling.
- `src/ui/`: React iframe UI and bilingual copy.
- `src/core/entitlements.ts`: free entitlement provider and future Pro/payment seam.

The arrow shaft uses [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand) (MIT) to turn the generated centerline into a pressure-sensitive filled vector outline. This gives the stroke an intentional light-to-full transition while keeping the arrow end full and rounded, without relying on Figma's renderer-specific variable stroke support.

Generated groups store versioned private plugin metadata under `sketch-arrow:metadata`. Future metadata formats should add migrations rather than rewriting existing arrows in place.

## Publishing checklist

Before publishing to Figma Community:

1. Create/register the plugin in Figma and replace the placeholder `manifest.json` ID (`000000000000000000`) with the assigned numeric Plugin ID.
2. Confirm the final product name and support contact.
3. Prepare the icon, cover, screenshots, Community description, and privacy disclosure.
4. Re-run `npm run check` and the manual scenarios below.

The MVP intentionally does not request the `payments` permission. A future Pro release can implement `EntitlementProvider` with `figma.payments` without changing geometry or document code.

## Manual QA matrix

- Horizontal, vertical, diagonal, reversed, rotated, and nested Lines.
- 40px, 220px, 800px, and 1600px distances.
- Two layers arranged horizontally, vertically, diagonally, rotated, and in Auto Layout.
- Layers in the same poster Frame and layers across top-level Frames.
- Move or delete source layers, then update.
- Natural/Loop, curvature extremes, roughness extremes, head-size extremes.
- Light/dark themes and Chinese/English UI.
- Reopen the plugin and confirm the last settings persist.

## Current boundaries

- Figma Design only.
- Custom Pen/Pencil paths are planned for a later release.
- Arrows do not update in the background; Figma plugins cannot stay running after they are closed.
- Two-layer connection uses oriented rectangular bounds for predictable performance.

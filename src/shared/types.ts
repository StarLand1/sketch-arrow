export type Locale = 'zh-CN' | 'en'
export type ArrowStyle = 'natural' | 'loop'
export type SourceMode = 'line' | 'two-nodes'

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface ArrowSettings {
  style: ArrowStyle
  color: RgbColor
  strokeWidth: number
  headScale: number
  curvature: number
  roughness: number
  reversed: boolean
}

export interface ArrowMetadataV1 {
  version: 1
  sourceMode: SourceMode
  sourceNodeIds: string[]
  seed: number
  settings: ArrowSettings
}

export interface LoopRendering {
  crossingStyle: 'knot'
  overpass: 'tail'
}

export interface ArrowMetadataV2 {
  version: 2
  sourceMode: SourceMode
  sourceNodeIds: string[]
  seed: number
  settings: ArrowSettings
  loopRendering: LoopRendering
}

export type ArrowMetadata = ArrowMetadataV1 | ArrowMetadataV2

export interface UserPreferences {
  locale: Locale
  settings: ArrowSettings
}

export type SelectionKind = 'line' | 'two-nodes' | 'generated-arrow' | 'invalid'

export interface SelectionSnapshot {
  kind: SelectionKind
  title: string
  detail: string
  nodeNames: string[]
  metadata?: ArrowMetadata
}

export const DEFAULT_SETTINGS: ArrowSettings = {
  style: 'natural',
  color: { r: 0.13, g: 0.13, b: 0.14 },
  strokeWidth: 8,
  headScale: 1,
  curvature: 0.28,
  roughness: 0.34,
  reversed: false,
}

export type UiToPluginMessage =
  | { type: 'ui-ready'; locale: Locale }
  | { type: 'generate'; settings: ArrowSettings }
  | { type: 'update'; settings: ArrowSettings; reroll?: boolean }
  | { type: 'save-preferences'; preferences: UserPreferences }

export type PluginToUiMessage =
  | { type: 'bootstrap'; selection: SelectionSnapshot; preferences: UserPreferences }
  | { type: 'selection'; selection: SelectionSnapshot }
  | {
      type: 'operation-result'
      ok: boolean
      code: 'generated' | 'updated' | 'invalid-selection' | 'source-missing' | 'too-close' | 'readonly' | 'unexpected'
    }

export function clampSettings(input: ArrowSettings): ArrowSettings {
  return {
    style: input.style === 'loop' ? 'loop' : 'natural',
    color: {
      r: clamp(input.color.r, 0, 1),
      g: clamp(input.color.g, 0, 1),
      b: clamp(input.color.b, 0, 1),
    },
    strokeWidth: clamp(input.strokeWidth, 1, 40),
    headScale: clamp(input.headScale, 0.55, 2),
    curvature: clamp(input.curvature, -1, 1),
    roughness: clamp(input.roughness, 0, 1),
    reversed: Boolean(input.reversed),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

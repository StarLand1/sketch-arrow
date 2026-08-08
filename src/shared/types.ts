export type Locale = 'zh-CN' | 'en'
export type ArrowStyle = 'natural' | 'loop' | 's-curve' | 'spiral' | 'wave' | 'emphasis'
export type BrushStyle = 'marker' | 'ink' | 'pencil' | 'highlighter'
export type ArrowHeadStyle = 'rounded' | 'open' | 'chunky' | 'swallowtail'
export type SourceMode = 'line' | 'two-nodes'

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface ArrowSettings {
  style: ArrowStyle
  brush: BrushStyle
  headStyle: ArrowHeadStyle
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

export interface ArrowMetadataV3 extends Omit<ArrowMetadataV2, 'version' | 'settings'> {
  version: 3
  settings: ArrowSettings
}

export type ArrowMetadata = ArrowMetadataV1 | ArrowMetadataV2 | ArrowMetadataV3

export interface UserPreset {
  id: string
  name: string
  settings: ArrowSettings
  createdAt: number
  updatedAt: number
}

export interface BrandColor {
  id: string
  name: string
  color: RgbColor
}

export type PaymentStatus = 'PAID' | 'UNPAID' | 'NOT_SUPPORTED'

export interface EntitlementSnapshot {
  tier: 'free' | 'pro'
  paymentStatus: PaymentStatus
}

export interface UserPreferences {
  locale: Locale
  settings: ArrowSettings
  presets: UserPreset[]
  brandColors: BrandColor[]
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
  brush: 'marker',
  headStyle: 'rounded',
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
  | { type: 'update'; settings: ArrowSettings }
  | { type: 'save-preferences'; preferences: UserPreferences }
  | { type: 'checkout' }

export type PluginToUiMessage =
  | {
      type: 'bootstrap'
      selection: SelectionSnapshot
      preferences: UserPreferences
      entitlement: EntitlementSnapshot
    }
  | { type: 'selection'; selection: SelectionSnapshot }
  | { type: 'entitlement'; entitlement: EntitlementSnapshot }
  | {
      type: 'operation-result'
      ok: boolean
      code:
        | 'generated'
        | 'updated'
        | 'invalid-selection'
        | 'source-missing'
        | 'too-close'
        | 'readonly'
        | 'premium-required'
        | 'payment-unavailable'
        | 'unexpected'
    }

export function clampSettings(input: Partial<ArrowSettings> | undefined): ArrowSettings {
  const source = input ?? {}
  return {
    style: isArrowStyle(source.style) ? source.style : DEFAULT_SETTINGS.style,
    brush: isBrushStyle(source.brush) ? source.brush : DEFAULT_SETTINGS.brush,
    headStyle: isArrowHeadStyle(source.headStyle) ? source.headStyle : DEFAULT_SETTINGS.headStyle,
    color: {
      // V1/V2 metadata did not have to be complete at runtime. Preserve the
      // current default when an older record is missing a channel instead of
      // silently turning it black.
      r: clamp(source.color?.r, 0, 1, DEFAULT_SETTINGS.color.r),
      g: clamp(source.color?.g, 0, 1, DEFAULT_SETTINGS.color.g),
      b: clamp(source.color?.b, 0, 1, DEFAULT_SETTINGS.color.b),
    },
    strokeWidth: clamp(source.strokeWidth, 1, 40, DEFAULT_SETTINGS.strokeWidth),
    headScale: clamp(source.headScale, 0.55, 2, DEFAULT_SETTINGS.headScale),
    curvature: clamp(source.curvature, -1, 1, DEFAULT_SETTINGS.curvature),
    roughness: clamp(source.roughness, 0, 1, DEFAULT_SETTINGS.roughness),
    reversed: Boolean(source.reversed),
  }
}

export function freeSettings(input: Partial<ArrowSettings> | undefined): ArrowSettings {
  const settings = clampSettings(input)
  return {
    ...settings,
    style: settings.style === 'loop' ? 'loop' : 'natural',
    brush: 'marker',
    headStyle: 'rounded',
    headScale: DEFAULT_SETTINGS.headScale,
    curvature: DEFAULT_SETTINGS.curvature,
    roughness: DEFAULT_SETTINGS.roughness,
  }
}

function clamp(value: number | undefined, min: number, max: number, fallback = min): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value! : fallback))
}

function isArrowStyle(value: unknown): value is ArrowStyle {
  return value === 'natural' || value === 'loop' || value === 's-curve'
    || value === 'spiral' || value === 'wave' || value === 'emphasis'
}

function isBrushStyle(value: unknown): value is BrushStyle {
  return value === 'marker' || value === 'ink' || value === 'pencil' || value === 'highlighter'
}

function isArrowHeadStyle(value: unknown): value is ArrowHeadStyle {
  return value === 'rounded' || value === 'open' || value === 'chunky' || value === 'swallowtail'
}

export type Locale = 'zh-CN' | 'en'
export type ArrowStyle = 'natural' | 'loop' | 's-curve' | 'wave'
/** Retired V5 path values accepted only while reading old local data. */
export type LegacyArrowStyle = ArrowStyle | 'spiral' | 'emphasis'
export type ArrowHeadStyle = 'solid' | 'hollow' | 'path'
export type StrokePattern = 'solid' | 'dashed' | 'dotted'
export type LineStyle = 'clean' | 'sketch' | 'double-drawn'
export type HeadSize = 'small' | 'medium' | 'large'
export type SourceMode = 'line' | 'two-nodes'

/** The three user-facing widths are intentionally stable document values.
 * They are 70% of the previous 5 / 8 / 12 px presets. */
export const STROKE_WIDTHS = {
  thin: 3.5,
  medium: 5.6,
  thick: 8.4,
} as const

/** Stable user-facing head-size scales, kept in ascending order. */
export const HEAD_SIZE_SCALES: Record<HeadSize, number> = {
  small: 1.4,
  medium: 1.55,
  large: 1.7,
}

export type StrokeWidthPreset = keyof typeof STROKE_WIDTHS
export const STROKE_WIDTH_VALUES = Object.values(STROKE_WIDTHS) as number[]

export interface RgbColor {
  r: number
  g: number
  b: number
}

/** V5 exposes only deliberate, discrete choices—no continuous style sliders. */
export interface ArrowSettings {
  style: ArrowStyle
  lineStyle: LineStyle
  headStyle: ArrowHeadStyle
  strokePattern: StrokePattern
  color: RgbColor
  strokeWidth: number
  headSize: HeadSize
  reversed: boolean
}

/** Serialized V1–V4 settings accepted by the in-memory migration. */
export interface LegacyArrowSettings {
  style?: LegacyArrowStyle
  brush?: 'marker' | 'ink' | 'pencil' | 'highlighter'
  headStyle?: ArrowHeadStyle | 'open'
  strokePattern?: StrokePattern
  color?: Partial<RgbColor>
  strokeWidth?: number
  headScale?: number
  curvature?: number
  roughness?: number
  reversed?: boolean
}

export interface ArrowSettingsInput extends LegacyArrowSettings {
  lineStyle?: LineStyle
  headSize?: HeadSize
}

export interface ArrowMetadataV1 {
  version: 1
  sourceMode: SourceMode
  sourceNodeIds: string[]
  seed: number
  settings: LegacyArrowSettings
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
  settings: LegacyArrowSettings
  loopRendering: LoopRendering
}

export interface ArrowMetadataV3 extends Omit<ArrowMetadataV2, 'version'> {
  version: 3
}

export interface ArrowMetadataV4 extends Omit<ArrowMetadataV2, 'version'> {
  version: 4
}

export interface ArrowMetadataV5 {
  version: 5
  sourceMode: SourceMode
  sourceNodeIds: string[]
  seed: number
  settings: ArrowSettings
  /** True once this arrow has first used a Pro trial capability. */
  proTrialClaimed: boolean
  /** Internal authored side retained when a V1–V4 arrow is migrated. */
  bend: -1 | 1
  loopRendering: LoopRendering
}

export type ArrowMetadata = ArrowMetadataV1 | ArrowMetadataV2 | ArrowMetadataV3 | ArrowMetadataV4 | ArrowMetadataV5

export interface UserPreset {
  id: string
  name: string
  settings: ArrowSettings
  createdAt: number
  updatedAt: number
}

export type PaymentStatus = 'PAID' | 'UNPAID' | 'NOT_SUPPORTED'

export interface EntitlementSnapshot {
  tier: 'free' | 'pro'
  paymentStatus: PaymentStatus
  /** Remaining Pro arrow slots for an unpaid user. */
  trialRemaining: number
}

export interface UserPreferences {
  locale: Locale
  settings: ArrowSettings
  presets: UserPreset[]
}

export type SelectionKind = 'line' | 'two-nodes' | 'generated-arrow' | 'invalid'

export interface SelectionSnapshot {
  kind: SelectionKind
  title: string
  detail: string
  nodeNames: string[]
  metadata?: ArrowMetadataV5
}

export const DEFAULT_SETTINGS: ArrowSettings = {
  style: 'natural',
  lineStyle: 'clean',
  headStyle: 'solid',
  strokePattern: 'solid',
  color: { r: 0.13, g: 0.13, b: 0.14 },
  strokeWidth: STROKE_WIDTHS.medium,
  headSize: 'medium',
  reversed: false,
}

export type ApplySettingsAction = 'normal' | 'rerandomize'

export type UiToPluginMessage =
  | { type: 'ui-ready'; locale: Locale }
  | { type: 'apply-settings'; settings: ArrowSettings; action?: ApplySettingsAction }
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

export function clampSettings(input: ArrowSettingsInput | undefined): ArrowSettings {
  const source = input ?? {}
  return {
    style: isArrowStyle(source.style) ? source.style : DEFAULT_SETTINGS.style,
    lineStyle: normalizeLineStyle(source),
    headStyle: normalizeHeadStyle(source.headStyle),
    strokePattern: isStrokePattern(source.strokePattern) ? source.strokePattern : DEFAULT_SETTINGS.strokePattern,
    color: {
      r: clamp(source.color?.r, 0, 1, DEFAULT_SETTINGS.color.r),
      g: clamp(source.color?.g, 0, 1, DEFAULT_SETTINGS.color.g),
      b: clamp(source.color?.b, 0, 1, DEFAULT_SETTINGS.color.b),
    },
    strokeWidth: nearestStrokeWidth(source.strokeWidth),
    headSize: normalizeHeadSize(source),
    reversed: Boolean(source.reversed),
  }
}

export function freeSettings(input: ArrowSettingsInput | undefined): ArrowSettings {
  const settings = clampSettings(input)
  return {
    ...settings,
    style: settings.style === 'loop' ? 'loop' : 'natural',
    lineStyle: 'clean',
    headStyle: 'solid',
    strokePattern: 'solid',
  }
}

export function headScaleForSize(size: HeadSize): number {
  return HEAD_SIZE_SCALES[size]
}

function clamp(value: number | undefined, min: number, max: number, fallback = min): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value! : fallback))
}

export function nearestStrokeWidth(value: number | undefined): number {
  const candidate = Number.isFinite(value) ? value! : DEFAULT_SETTINGS.strokeWidth
  return STROKE_WIDTH_VALUES.reduce((nearest, current) => {
    return Math.abs(current - candidate) < Math.abs(nearest - candidate) ? current : nearest
  }, DEFAULT_SETTINGS.strokeWidth)
}

function normalizeHeadSize(source: ArrowSettingsInput): HeadSize {
  if (source.headSize === 'small' || source.headSize === 'medium' || source.headSize === 'large') {
    return source.headSize
  }
  if (Number.isFinite(source.headScale)) {
    const scale = source.headScale!
    if (scale < 1.1) return 'small'
    if (scale < 1.35) return 'medium'
    return 'large'
  }
  return DEFAULT_SETTINGS.headSize
}

function normalizeLineStyle(source: ArrowSettingsInput): LineStyle {
  if (source.lineStyle === 'clean' || source.lineStyle === 'sketch' || source.lineStyle === 'double-drawn') {
    return source.lineStyle
  }
  if (source.brush === 'pencil' || (source.roughness ?? 0) >= 0.62) return 'sketch'
  return DEFAULT_SETTINGS.lineStyle
}

function isArrowStyle(value: unknown): value is ArrowStyle {
  return value === 'natural' || value === 'loop' || value === 's-curve' || value === 'wave'
}

function normalizeHeadStyle(value: unknown): ArrowHeadStyle {
  if (value === 'solid' || value === 'hollow' || value === 'path') return value
  if (value === 'open') return 'path'
  return 'solid'
}

function isStrokePattern(value: unknown): value is StrokePattern {
  return value === 'solid' || value === 'dashed' || value === 'dotted'
}

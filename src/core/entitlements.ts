export type EntitlementTier = 'free' | 'pro'

export type Feature =
  | 'line-generation'
  | 'two-node-generation'
  | 'natural-style'
  | 'loop-style'
  | 'advanced-styles'
  | 'batch-generation'
  | 'shared-presets'

export interface EntitlementProvider {
  getTier(): Promise<EntitlementTier>
  canUse(feature: Feature): Promise<boolean>
}

const FREE_FEATURES = new Set<Feature>([
  'line-generation',
  'two-node-generation',
  'natural-style',
  'loop-style',
])

export class LocalFreeEntitlementProvider implements EntitlementProvider {
  async getTier(): Promise<EntitlementTier> {
    return 'free'
  }

  async canUse(feature: Feature): Promise<boolean> {
    return FREE_FEATURES.has(feature)
  }
}

// A future FigmaPaymentsEntitlementProvider can implement this interface without
// coupling payment checks to geometry, document writes, or the React UI.
export const entitlements: EntitlementProvider = new LocalFreeEntitlementProvider()

import type { EntitlementSnapshot, PaymentStatus } from '../shared/types'

export type EntitlementTier = 'free' | 'pro'

export type Feature =
  | 'line-generation'
  | 'two-node-generation'
  | 'natural-style'
  | 'loop-style'
  | 'advanced-styles'
  | 'pro-parameters'
  | 'brush-styles'
  | 'head-styles'
  | 'presets'
  | 'brand-colors'

export interface EntitlementProvider {
  getSnapshot(): Promise<EntitlementSnapshot>
  canUse(feature: Feature): Promise<boolean>
  checkout(): Promise<EntitlementSnapshot>
}

const FREE_FEATURES = new Set<Feature>([
  'line-generation',
  'two-node-generation',
  'natural-style',
  'loop-style',
])

export class LocalFreeEntitlementProvider implements EntitlementProvider {
  async getSnapshot(): Promise<EntitlementSnapshot> {
    return { tier: 'free', paymentStatus: 'UNPAID' }
  }

  async canUse(feature: Feature): Promise<boolean> {
    return FREE_FEATURES.has(feature)
  }

  async checkout(): Promise<EntitlementSnapshot> {
    return this.getSnapshot()
  }
}

export class FigmaPaymentsEntitlementProvider implements EntitlementProvider {
  async getSnapshot(): Promise<EntitlementSnapshot> {
    const status = readPaymentStatus()
    return { tier: status === 'PAID' ? 'pro' : 'free', paymentStatus: status }
  }

  async canUse(feature: Feature): Promise<boolean> {
    const snapshot = await this.getSnapshot()
    return snapshot.tier === 'pro' || FREE_FEATURES.has(feature)
  }

  async checkout(): Promise<EntitlementSnapshot> {
    try {
      const payments = typeof figma === 'undefined' ? undefined : figma.payments
      if (!payments) return this.getSnapshot()
      await payments.initiateCheckoutAsync({ interstitial: 'PAID_FEATURE' })
      return this.getSnapshot()
    } catch (error) {
      throw error instanceof Error ? error : new Error('Payment checkout is unavailable.')
    }
  }
}

function readPaymentStatus(): PaymentStatus {
  try {
    const status = figma.payments?.status.type
    return status === 'PAID' || status === 'UNPAID' || status === 'NOT_SUPPORTED'
      ? status
      : 'NOT_SUPPORTED'
  } catch {
    // Local development manifests and older Figma runtimes may expose the
    // payments object without a readable status. Treat that as unavailable,
    // never as paid.
    return 'NOT_SUPPORTED'
  }
}

// Figma payments is available in the published plugin once the manifest has
// the `payments` permission. Keeping the provider behind this seam lets the
// geometry and document code remain usable in local tests.
export const entitlements: EntitlementProvider = new FigmaPaymentsEntitlementProvider()

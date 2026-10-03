import type { EntitlementSnapshot, PaymentStatus } from '../shared/types'

export type EntitlementTier = 'free' | 'pro'

/** Five complete Pro arrow slots are available before checkout. */
export const PRO_TRIAL_LIMIT = 5
const PRO_TRIAL_USAGE_KEY = 'sketch-arrow:pro-trial-generations-v1'
let volatileProTrialUses = 0

export type Feature =
  | 'line-generation'
  | 'two-node-generation'
  | 'natural-style'
  | 'loop-style'
  | 'advanced-styles'
  | 'head-sizes'
  | 'line-styles'
  | 'head-variants'
  | 'stroke-patterns'
  | 'presets'

export interface EntitlementProvider {
  getSnapshot(): Promise<EntitlementSnapshot>
  canUse(feature: Feature): Promise<boolean>
  checkout(): Promise<EntitlementSnapshot>
}

const FREE_FEATURES = new Set<Feature>([
  'line-generation',
  'natural-style',
  'loop-style',
  'head-sizes',
])

export class LocalFreeEntitlementProvider implements EntitlementProvider {
  async getSnapshot(): Promise<EntitlementSnapshot> {
    return { tier: 'free', paymentStatus: 'UNPAID', trialRemaining: 0 }
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
    return { tier: status === 'PAID' ? 'pro' : 'free', paymentStatus: status, trialRemaining: 0 }
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

/**
 * Combines Figma's paid status with this plugin's local five-arrow Pro
 * experience. A paid user does not need a trial balance, so it remains zero.
 */
export async function getCommercialEntitlement(): Promise<EntitlementSnapshot> {
  const payment = await entitlements.getSnapshot()
  if (payment.tier === 'pro') return payment
  const used = await readProTrialUses()
  return {
    ...payment,
    trialRemaining: Math.max(0, PRO_TRIAL_LIMIT - used),
  }
}

/**
 * Claims one trial only when an arrow first needs a Pro capability. Updates to
 * that same trial arrow are tracked in its metadata and do not claim again.
 */
export async function claimProTrial(): Promise<EntitlementSnapshot | null> {
  const current = await getCommercialEntitlement()
  if (current.tier === 'pro') return current
  if (current.trialRemaining <= 0) return null
  const nextUsed = PRO_TRIAL_LIMIT - current.trialRemaining + 1
  await writeProTrialUses(nextUsed)
  return {
    ...current,
    trialRemaining: current.trialRemaining - 1,
  }
}

async function readProTrialUses(): Promise<number> {
  if (!hasClientStorage()) return volatileProTrialUses
  try {
    const value = await figma.clientStorage.getAsync(PRO_TRIAL_USAGE_KEY)
    return normalizeTrialUses(value)
  } catch {
    return volatileProTrialUses
  }
}

async function writeProTrialUses(value: number): Promise<void> {
  const normalized = normalizeTrialUses(value)
  volatileProTrialUses = normalized
  if (!hasClientStorage()) return
  try {
    await figma.clientStorage.setAsync(PRO_TRIAL_USAGE_KEY, normalized)
  } catch {
    throw new Error('Unable to save Pro trial usage.')
  }
}

function hasClientStorage(): boolean {
  return typeof figma !== 'undefined'
    && typeof figma.clientStorage?.getAsync === 'function'
    && typeof figma.clientStorage?.setAsync === 'function'
}

function normalizeTrialUses(value: unknown): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(PRO_TRIAL_LIMIT, Math.floor(Number(value))))
}

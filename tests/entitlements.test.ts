import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimProTrial,
  FigmaPaymentsEntitlementProvider,
  getCommercialEntitlement,
  LocalFreeEntitlementProvider,
  PRO_TRIAL_LIMIT,
} from '../src/core/entitlements'

afterEach(() => vi.unstubAllGlobals())

describe('free entitlement', () => {
  it('exposes only the permanently free capabilities', async () => {
    const provider = new LocalFreeEntitlementProvider()
    expect(await provider.getSnapshot()).toEqual({ tier: 'free', paymentStatus: 'UNPAID', trialRemaining: 0 })
    await expect(provider.canUse('line-generation')).resolves.toBe(true)
    await expect(provider.canUse('two-node-generation')).resolves.toBe(false)
    await expect(provider.canUse('natural-style')).resolves.toBe(true)
    await expect(provider.canUse('loop-style')).resolves.toBe(true)
    await expect(provider.canUse('advanced-styles')).resolves.toBe(false)
    await expect(provider.canUse('head-sizes')).resolves.toBe(true)
    await expect(provider.canUse('line-styles')).resolves.toBe(false)
    await expect(provider.canUse('head-variants')).resolves.toBe(false)
    await expect(provider.canUse('stroke-patterns')).resolves.toBe(false)
    await expect(provider.canUse('presets')).resolves.toBe(false)
  })

  it('maps a paid Figma status to Pro and uses the checkout API', async () => {
    const initiateCheckoutAsync = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('figma', {
      payments: {
        status: { type: 'PAID' },
        initiateCheckoutAsync,
      },
    })
    const provider = new FigmaPaymentsEntitlementProvider()
    await expect(provider.getSnapshot()).resolves.toEqual({ tier: 'pro', paymentStatus: 'PAID', trialRemaining: 0 })
    await expect(provider.canUse('advanced-styles')).resolves.toBe(true)
    await expect(provider.canUse('head-sizes')).resolves.toBe(true)
    await expect(provider.canUse('line-styles')).resolves.toBe(true)
    await expect(provider.canUse('head-variants')).resolves.toBe(true)
    await expect(provider.canUse('stroke-patterns')).resolves.toBe(true)
    await provider.checkout()
    expect(initiateCheckoutAsync).toHaveBeenCalledWith({ interstitial: 'PAID_FEATURE' })
  })

  it('gives an unpaid user five persisted Pro arrow slots', async () => {
    const storage = new Map<string, unknown>()
    vi.stubGlobal('figma', {
      payments: { status: { type: 'UNPAID' } },
      clientStorage: {
        getAsync: vi.fn(async (key: string) => storage.get(key)),
        setAsync: vi.fn(async (key: string, value: unknown) => { storage.set(key, value) }),
      },
    })

    await expect(getCommercialEntitlement()).resolves.toEqual({
      tier: 'free',
      paymentStatus: 'UNPAID',
      trialRemaining: PRO_TRIAL_LIMIT,
    })
    for (let remaining = PRO_TRIAL_LIMIT - 1; remaining >= 0; remaining -= 1) {
      await expect(claimProTrial()).resolves.toMatchObject({
        tier: 'free',
        trialRemaining: remaining,
      })
    }
    await expect(claimProTrial()).resolves.toBeNull()
  })
})

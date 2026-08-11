import { afterEach, describe, expect, it, vi } from 'vitest'
import { FigmaPaymentsEntitlementProvider, LocalFreeEntitlementProvider } from '../src/core/entitlements'

afterEach(() => vi.unstubAllGlobals())

describe('free entitlement', () => {
  it('exposes only the permanently free capabilities', async () => {
    const provider = new LocalFreeEntitlementProvider()
    expect(await provider.getSnapshot()).toEqual({ tier: 'free', paymentStatus: 'UNPAID' })
    await expect(provider.canUse('line-generation')).resolves.toBe(true)
    await expect(provider.canUse('two-node-generation')).resolves.toBe(true)
    await expect(provider.canUse('natural-style')).resolves.toBe(true)
    await expect(provider.canUse('loop-style')).resolves.toBe(true)
    await expect(provider.canUse('advanced-styles')).resolves.toBe(false)
    await expect(provider.canUse('head-sizes')).resolves.toBe(false)
    await expect(provider.canUse('line-styles')).resolves.toBe(false)
    await expect(provider.canUse('head-variants')).resolves.toBe(false)
    await expect(provider.canUse('stroke-patterns')).resolves.toBe(false)
    await expect(provider.canUse('presets')).resolves.toBe(false)
    await expect(provider.canUse('brand-colors')).resolves.toBe(false)
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
    await expect(provider.getSnapshot()).resolves.toEqual({ tier: 'pro', paymentStatus: 'PAID' })
    await expect(provider.canUse('advanced-styles')).resolves.toBe(true)
    await expect(provider.canUse('head-sizes')).resolves.toBe(true)
    await expect(provider.canUse('line-styles')).resolves.toBe(true)
    await expect(provider.canUse('head-variants')).resolves.toBe(true)
    await expect(provider.canUse('stroke-patterns')).resolves.toBe(true)
    await provider.checkout()
    expect(initiateCheckoutAsync).toHaveBeenCalledWith({ interstitial: 'PAID_FEATURE' })
  })
})

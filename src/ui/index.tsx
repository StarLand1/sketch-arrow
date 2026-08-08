import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getStatusCopy, getStrings } from './i18n'
import {
  DEFAULT_SETTINGS,
  type ArrowHeadStyle,
  type ArrowSettings,
  type ArrowStyle,
  type BrandColor,
  type EntitlementSnapshot,
  type Locale,
  type PluginToUiMessage,
  type RgbColor,
  type SelectionSnapshot,
  type UiToPluginMessage,
  type UserPreset,
} from '../shared/types'

const EMPTY_SELECTION: SelectionSnapshot = { kind: 'invalid', title: '', detail: '', nodeNames: [] }
const FREE_ENTITLEMENT: EntitlementSnapshot = { tier: 'free', paymentStatus: 'UNPAID' }

function App() {
  const systemLocale: Locale = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  const [locale, setLocale] = useState<Locale>(systemLocale)
  const [settings, setSettings] = useState<ArrowSettings>(DEFAULT_SETTINGS)
  const [selection, setSelection] = useState<SelectionSnapshot>(EMPTY_SELECTION)
  const [entitlement, setEntitlement] = useState<EntitlementSnapshot>(FREE_ENTITLEMENT)
  const [presets, setPresets] = useState<UserPreset[]>([])
  const [brandColors, setBrandColors] = useState<BrandColor[]>([])
  const [bootstrapped, setBootstrapped] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const localeRef = useRef<Locale>(locale)
  const strings = useMemo(() => getStrings(locale), [locale])
  const [statusTitle, statusDetail] = getStatusCopy(locale, selection.kind)
  const canGenerate = selection.kind === 'line' || selection.kind === 'two-nodes'
  const canUpdate = selection.kind === 'generated-arrow'
  const isPro = entitlement.tier === 'pro'

  useEffect(() => { localeRef.current = locale }, [locale])

  useEffect(() => {
    const handler = (event: MessageEvent<{ pluginMessage?: PluginToUiMessage }>) => {
      const message = event.data.pluginMessage
      if (!message) return
      if (message.type === 'bootstrap') {
        setLocale(message.preferences.locale)
        setSelection(message.selection)
        setSettings(message.selection.metadata?.settings ?? message.preferences.settings)
        setPresets(message.preferences.presets ?? [])
        setBrandColors(message.preferences.brandColors ?? [])
        setEntitlement(message.entitlement)
        setBootstrapped(true)
        return
      }
      if (message.type === 'selection') {
        setSelection(message.selection)
        if (message.selection.metadata) setSettings(message.selection.metadata.settings)
        return
      }
      if (message.type === 'entitlement') {
        setEntitlement(message.entitlement)
        if (message.entitlement.tier === 'pro') setShowUpgrade(false)
        return
      }
      if (message.type === 'operation-result') {
        const operationCopy = getStrings(localeRef.current).operation
        const copy = operationCopy[message.code] ?? operationCopy.unexpected
        setToast({ ok: message.ok, text: copy })
        window.clearTimeout(toastTimer.current)
        toastTimer.current = window.setTimeout(() => setToast(null), 2800)
      }
    }
    window.addEventListener('message', handler)
    postToPlugin({ type: 'ui-ready', locale: systemLocale })
    return () => {
      window.removeEventListener('message', handler)
      window.clearTimeout(toastTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!bootstrapped) return
    const timer = window.setTimeout(() => {
      postToPlugin({ type: 'save-preferences', preferences: { locale, settings, presets, brandColors } })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [bootstrapped, locale, settings, presets, brandColors])

  function requestUpgrade() { setShowUpgrade(true) }

  function updateSetting<K extends keyof ArrowSettings>(key: K, value: ArrowSettings[K]) {
    const proKeys: (keyof ArrowSettings)[] = ['headScale', 'curvature', 'roughness', 'brush', 'headStyle']
    if (!isPro && proKeys.includes(key)) {
      requestUpgrade()
      return
    }
    if (!isPro && key === 'style' && value !== 'natural' && value !== 'loop') {
      requestUpgrade()
      return
    }
    setSettings((current) => ({ ...current, [key]: value }))
  }

  function runPrimaryAction() {
    if (canUpdate) postToPlugin({ type: 'update', settings })
    else if (canGenerate) postToPlugin({ type: 'generate', settings })
  }

  function reverseDirection() {
    const next = { ...settings, reversed: !settings.reversed }
    setSettings(next)
    if (canUpdate) postToPlugin({ type: 'update', settings: next })
  }

  function savePreset() {
    if (!isPro) return requestUpgrade()
    const name = window.prompt(strings.presetNamePrompt, `${strings.preset} ${presets.length + 1}`)
    if (!name?.trim()) return
    const now = Date.now()
    setPresets((current) => [...current.slice(-29), {
      id: `preset-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(), settings, createdAt: now, updatedAt: now,
    }])
  }

  function saveBrandColor() {
    if (!isPro) return requestUpgrade()
    const name = window.prompt(strings.brandColorNamePrompt, `${strings.brandColor} ${brandColors.length + 1}`)
    if (!name?.trim()) return
    setBrandColors((current) => [...current.slice(-15), {
      id: `color-${Date.now()}`, name: name.trim(), color: settings.color,
    }])
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <ArrowMark />
          <span>{strings.appName}</span>
          <span className="badge">{isPro ? strings.pro : strings.free}</span>
        </div>
        <div className="language-switch" role="group" aria-label="Language">
          <button className={locale === 'zh-CN' ? 'active' : ''} onClick={() => setLocale('zh-CN')}>中</button>
          <button className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button>
        </div>
      </header>

      <section className={`selection-card selection-${selection.kind}`}>
        <span className="status-dot" />
        <div className="selection-copy">
          <strong>{statusTitle}</strong>
          <span>{statusDetail}</span>
          {selection.nodeNames.length > 0 && (
            <div className="node-list">{selection.nodeNames.map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}</div>
          )}
        </div>
      </section>

      <section className="control-section">
        <ControlLabel>{strings.style}</ControlLabel>
        <div className="style-grid">
          <StyleButton active={settings.style === 'natural'} label={strings.natural} preview="natural" onClick={() => updateSetting('style', 'natural')} />
          <StyleButton active={settings.style === 'loop'} label={strings.loop} preview="loop" onClick={() => updateSetting('style', 'loop')} />
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading"><ControlLabel>{strings.advancedStyles}</ControlLabel><ProTag /></div>
        <div className="style-grid pro-grid">
          {(['s-curve', 'spiral', 'wave', 'emphasis'] as const).map((style) => (
            <StyleButton
              key={style}
              active={settings.style === style}
              label={strings.styles[style]}
              preview={style}
              locked={!isPro}
              onClick={() => updateSetting('style', style)}
            />
          ))}
        </div>
      </section>

      <section className="control-section settings-grid">
        <ColorField
          label={strings.color}
          value={settings.color}
          brandColors={brandColors}
          onChange={(color) => updateSetting('color', color)}
          onSaveColor={saveBrandColor}
          strings={strings}
        />
        <RangeField label={strings.strokeWidth} min={1} max={24} step={1} value={settings.strokeWidth} display={`${Math.round(settings.strokeWidth)} px`} onChange={(value) => updateSetting('strokeWidth', value)} />
        <LockedRange locked={!isPro} label={strings.headSize} min={0.55} max={2} step={0.05} value={settings.headScale} display={`${Math.round(settings.headScale * 100)}%`} onChange={(value) => updateSetting('headScale', value)} onUpgrade={requestUpgrade} />
        <LockedRange locked={!isPro} label={strings.curvature} min={-1} max={1} step={0.02} value={settings.curvature} display={settings.curvature < 0 ? strings.left : strings.right} onChange={(value) => updateSetting('curvature', value)} onUpgrade={requestUpgrade} />
        <LockedRange locked={!isPro} label={strings.roughness} min={0} max={1} step={0.02} value={settings.roughness} display={settings.roughness < 0.5 ? strings.subtle : strings.strong} onChange={(value) => updateSetting('roughness', value)} onUpgrade={requestUpgrade} />
      </section>

      <section className="control-section">
        <div className="section-heading"><ControlLabel>{strings.brush}</ControlLabel><ProTag /></div>
        <OptionGrid values={['marker', 'ink', 'pencil', 'highlighter']} selected={settings.brush} labels={strings.brushes} locked={!isPro} onSelect={(value) => updateSetting('brush', value)} onUpgrade={requestUpgrade} />
      </section>

      <section className="control-section">
        <div className="section-heading"><ControlLabel>{strings.headStyle}</ControlLabel><ProTag /></div>
        <OptionGrid values={['rounded', 'open', 'chunky', 'swallowtail']} selected={settings.headStyle} labels={strings.heads} locked={!isPro} onSelect={(value) => updateSetting('headStyle', value)} onUpgrade={requestUpgrade} />
      </section>

      <section className="control-section presets-section">
        <div className="section-heading"><ControlLabel>{strings.presets}</ControlLabel><ProTag /></div>
        <div className="preset-actions">
          <button className="secondary-button" onClick={savePreset}>{strings.savePreset}</button>
          <button className="secondary-button" onClick={saveBrandColor}>{strings.saveBrandColor}</button>
        </div>
        {presets.length > 0 && <div className="preset-list">{presets.slice(-4).map((preset) => <button key={preset.id} onClick={() => isPro ? setSettings(preset.settings) : requestUpgrade()}>{preset.name}</button>)}</div>}
      </section>

      <section className="secondary-actions">
        <button className={`secondary-button ${settings.reversed ? 'is-active' : ''}`} onClick={reverseDirection}><ReverseIcon /> {strings.reverse}</button>
      </section>

      <footer className="footer-actions">
        <button className="primary-button" disabled={!canGenerate && !canUpdate} onClick={runPrimaryAction}>{canUpdate ? strings.update : strings.generate}</button>
        <p>{strings.hint}</p>
      </footer>

      {showUpgrade && <UpgradePanel strings={strings} status={entitlement.paymentStatus} onClose={() => setShowUpgrade(false)} onCheckout={() => postToPlugin({ type: 'checkout' })} />}
      {toast && <div className={`toast ${toast.ok ? 'success' : 'error'}`}>{toast.text}</div>}
    </main>
  )
}

function ControlLabel({ children }: { children: React.ReactNode }) { return <div className="control-label">{children}</div> }
function ProTag() { return <span className="pro-tag">PRO</span> }

function StyleButton({ active, label, preview, locked = false, onClick }: { active: boolean; label: string; preview: ArrowStyle; locked?: boolean; onClick: () => void }) {
  return <button className={`style-button ${active ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={onClick}>
    <svg viewBox="0 0 112 40" aria-hidden="true"><path d={stylePreviewPath(preview)} /></svg>
    <span>{label}</span>{locked && <span className="lock-mark">⌑</span>}
  </button>
}

function stylePreviewPath(style: ArrowStyle): string {
  if (style === 'loop') return 'M8 29 C25 8 49 7 53 19 C57 31 36 34 34 20 C32 8 71 6 101 25 M91 16 Q98 20 101 25 M90 31 Q97 27 101 25'
  if (style === 's-curve') return 'M8 28 C28 2 44 12 56 20 C68 28 84 38 101 12'
  if (style === 'spiral') return 'M8 28 C28 8 40 8 49 20 C59 34 42 38 36 26 C31 15 58 8 101 24'
  if (style === 'wave') return 'M8 24 C20 6 31 38 44 20 C57 2 68 38 81 20 C88 10 95 18 101 25'
  if (style === 'emphasis') return 'M8 27 C34 5 70 10 101 24 M87 14 Q96 18 101 24 M89 31 Q97 27 101 24'
  return 'M8 29 C37 4 76 8 101 25 M91 16 Q98 20 101 25 M90 31 Q97 27 101 25'
}

function RangeField({ label, min, max, step, value, display, onChange, disabled = false }: { label: string; min: number; max: number; step: number; value: number; display: string; onChange: (value: number) => void; disabled?: boolean }) {
  return <label className={`range-field ${disabled ? 'locked-field' : ''}`}>
    <span className="range-heading"><span>{label}</span><output>{display}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
  </label>
}

function LockedRange(props: React.ComponentProps<typeof RangeField> & { locked: boolean; onUpgrade: () => void }) {
  const { locked, onUpgrade, ...rangeProps } = props
  return <div className={`locked-range ${locked ? 'is-locked' : ''}`} role={locked ? 'button' : undefined} tabIndex={locked ? 0 : undefined} aria-disabled={locked || undefined} onClick={locked ? onUpgrade : undefined} onKeyDown={locked ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onUpgrade() } } : undefined}>
    <RangeField {...rangeProps} disabled={locked} />
    {locked && <ProTag />}
  </div>
}

function OptionGrid({ values, selected, labels, locked, onSelect, onUpgrade }: { values: string[]; selected: string; labels: Record<string, string>; locked: boolean; onSelect: (value: never) => void; onUpgrade: () => void }) {
  return <div className="option-grid">{values.map((value) => <button key={value} className={`option-button ${selected === value ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={() => locked ? onUpgrade() : onSelect(value as never)}>{labels[value]}{locked && <span>⌑</span>}</button>)}</div>
}

function ColorField({ label, value, brandColors, onChange, onSaveColor, strings }: { label: string; value: RgbColor; brandColors: BrandColor[]; onChange: (value: RgbColor) => void; onSaveColor: () => void; strings: ReturnType<typeof getStrings> }) {
  return <div className="color-field">
    <label className="field-row color-row"><span>{label}</span><span className="color-control"><input type="color" value={rgbToHex(value)} onChange={(event) => onChange(hexToRgb(event.target.value))} /><code>{rgbToHex(value).toUpperCase()}</code></span></label>
    <div className="color-swatches">{brandColors.slice(-6).map((brand) => <button key={brand.id} title={brand.name} style={{ background: rgbToHex(brand.color) }} onClick={() => onChange(brand.color)} />)}<button className="add-swatch" onClick={onSaveColor}>＋</button></div>
    <small>{strings.localOnly}</small>
  </div>
}

function UpgradePanel({ strings, status, onClose, onCheckout }: { strings: ReturnType<typeof getStrings>; status: EntitlementSnapshot['paymentStatus']; onClose: () => void; onCheckout: () => void }) {
  return <div className="upgrade-backdrop"><section className="upgrade-panel"><button className="close-button" onClick={onClose}>×</button><h2>{strings.upgradeTitle}</h2><p>{strings.upgradeDescription}</p><ul><li>{strings.upgradeItems.parameters}</li><li>{strings.upgradeItems.styles}</li><li>{strings.upgradeItems.presets}</li></ul>{status === 'NOT_SUPPORTED' && <p className="upgrade-error">{strings.paymentUnavailable}</p>}<button className="primary-button" disabled={status === 'NOT_SUPPORTED'} onClick={onCheckout}>{strings.upgradeButton}</button></section></div>
}

function ArrowMark() { return <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7 C10 3 17 7 17 13 C17 16 14 18 11 16 C8 14 11 10 15 12 C18 13 19 16 20 19 M16 17 L20 19 L18 14" /></svg> }
function ReverseIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h9M5 2 2 5l3 3M13 11H4m7-3 3 3-3 3" /></svg> }
function postToPlugin(message: UiToPluginMessage) { parent.postMessage({ pluginMessage: message }, '*') }
function rgbToHex(color: RgbColor): string { return `#${[color.r, color.g, color.b].map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0')).join('')}` }
function hexToRgb(hex: string): RgbColor { const value = Number.parseInt(hex.slice(1), 16); return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 } }

createRoot(document.getElementById('root')!).render(<App />)

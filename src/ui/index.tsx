import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getStatusCopy, getStrings } from './i18n'
import {
  DEFAULT_SETTINGS,
  STROKE_WIDTHS,
  type ApplySettingsAction,
  type ArrowSettings,
  type ArrowStyle,
  type BrandColor,
  type EntitlementSnapshot,
  type HeadSize,
  type LineStyle,
  type Locale,
  type PluginToUiMessage,
  type RgbColor,
  type SelectionSnapshot,
  type StrokePattern,
  type UiToPluginMessage,
  type UserPreset,
} from '../shared/types'

const EMPTY_SELECTION: SelectionSnapshot = { kind: 'invalid', title: '', detail: '', nodeNames: [] }
const FREE_ENTITLEMENT: EntitlementSnapshot = { tier: 'free', paymentStatus: 'UNPAID' }
const PATH_STYLES: ArrowStyle[] = ['natural', 'loop', 's-curve', 'wave']
const COMMON_COLORS: Array<{ name: string; color: RgbColor }> = [
  { name: 'Black', color: { r: 0.13, g: 0.13, b: 0.14 } },
  { name: 'White', color: { r: 1, g: 1, b: 1 } },
  { name: 'Red', color: { r: 1, g: 0.231, b: 0.188 } },
  { name: 'Orange', color: { r: 1, g: 0.584, b: 0 } },
  { name: 'Yellow', color: { r: 1, g: 0.8, b: 0 } },
  { name: 'Green', color: { r: 0.204, g: 0.78, b: 0.349 } },
  { name: 'Blue', color: { r: 0.204, g: 0.471, b: 0.965 } },
  { name: 'Purple', color: { r: 0.424, g: 0.361, b: 0.906 } },
]

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
  const pendingApplyRef = useRef(false)
  const queuedApplyRef = useRef<{ settings: ArrowSettings; action: ApplySettingsAction } | null>(null)
  const strings = useMemo(() => getStrings(locale), [locale])
  const [statusTitle, statusDetail] = getStatusCopy(locale, selection.kind)
  const hasApplicableSelection = selection.kind === 'line'
    || selection.kind === 'two-nodes'
    || selection.kind === 'generated-arrow'
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
        pendingApplyRef.current = false
        const queued = queuedApplyRef.current
        queuedApplyRef.current = null
        if (queued) {
          pendingApplyRef.current = true
          postToPlugin({ type: 'apply-settings', settings: queued.settings, action: queued.action })
        }

        // Instant updates should feel quiet; success feedback is useful on the
        // first generation, while errors always remain visible.
        if (message.ok && message.code === 'updated') return
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

  function sendApply(next: ArrowSettings, action: ApplySettingsAction = 'normal') {
    if (!hasApplicableSelection) return
    if (pendingApplyRef.current) {
      queuedApplyRef.current = { settings: next, action }
      return
    }
    pendingApplyRef.current = true
    postToPlugin({ type: 'apply-settings', settings: next, action })
  }

  function applySettings(next: ArrowSettings, action: ApplySettingsAction = 'normal') {
    setSettings(next)
    sendApply(next, action)
  }

  function updateSetting<K extends keyof ArrowSettings>(key: K, value: ArrowSettings[K]) {
    if (!isPro && key === 'headSize' && value !== 'medium') return requestUpgrade()
    if (!isPro && key === 'lineStyle' && value !== 'clean') return requestUpgrade()
    if (!isPro && key === 'headStyle' && value !== 'solid') return requestUpgrade()
    if (!isPro && key === 'strokePattern' && value !== 'solid') return requestUpgrade()
    if (!isPro && key === 'style' && value !== 'natural' && value !== 'loop') return requestUpgrade()
    applySettings({ ...settings, [key]: value })
  }

  function reverseDirection() {
    applySettings({ ...settings, reversed: !settings.reversed })
  }

  function rerandomize() {
    applySettings(settings, 'rerandomize')
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
        <div className="section-heading"><ControlLabel>{strings.pathShape}</ControlLabel><ProTag /></div>
        <div className="style-grid path-grid">
          {PATH_STYLES.map((style) => {
            const locked = !isPro && style !== 'natural' && style !== 'loop'
            const label = style === 'natural' ? strings.natural : style === 'loop' ? strings.loop : strings.styles[style]
            return <StyleButton
              key={style}
              active={settings.style === style}
              label={label}
              preview={style}
              locked={locked}
              onClick={() => locked ? requestUpgrade() : updateSetting('style', style)}
            />
          })}
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
        <WidthField label={strings.strokeWidth} value={settings.strokeWidth} labels={strings.widths} onChange={(value) => updateSetting('strokeWidth', value)} />

        <div>
          <div className="section-heading"><ControlLabel>{strings.headSize}</ControlLabel><ProTag /></div>
          <OptionGrid
            values={['small', 'medium', 'large']}
            selected={settings.headSize}
            labels={strings.headSizes}
            lockedValues={!isPro ? ['small', 'large'] : []}
            onSelect={(value) => updateSetting('headSize', value as HeadSize)}
            onUpgrade={requestUpgrade}
            preview="head-size"
          />
        </div>

        <div>
          <div className="section-heading"><ControlLabel>{strings.strokePattern}</ControlLabel><ProTag /></div>
          <OptionGrid
            values={['solid', 'dashed', 'dotted']}
            selected={settings.strokePattern}
            labels={strings.patterns}
            lockedValues={!isPro ? ['dashed', 'dotted'] : []}
            onSelect={(value) => updateSetting('strokePattern', value as StrokePattern)}
            onUpgrade={requestUpgrade}
            preview="pattern"
          />
        </div>

        <div>
          <div className="section-heading"><ControlLabel>{strings.lineStyle}</ControlLabel><ProTag /></div>
          <OptionGrid
            values={['clean', 'sketch', 'double-drawn']}
            selected={settings.lineStyle}
            labels={strings.lineStyles}
            lockedValues={!isPro ? ['sketch', 'double-drawn'] : []}
            onSelect={(value) => updateSetting('lineStyle', value as LineStyle)}
            onUpgrade={requestUpgrade}
            preview="line-style"
          />
        </div>

        <div>
          <div className="section-heading"><ControlLabel>{strings.headStyle}</ControlLabel><ProTag /></div>
          <OptionGrid
            values={['solid', 'hollow', 'path']}
            selected={settings.headStyle}
            labels={strings.heads}
            lockedValues={!isPro ? ['hollow', 'path'] : []}
            onSelect={(value) => updateSetting('headStyle', value as ArrowSettings['headStyle'])}
            onUpgrade={requestUpgrade}
            preview="head"
          />
        </div>
      </section>

      <section className="control-section presets-section">
        <div className="section-heading"><ControlLabel>{strings.presets}</ControlLabel><ProTag /></div>
        <div className="preset-actions">
          <button className="secondary-button" onClick={savePreset}>{strings.savePreset}</button>
          <button className="secondary-button" onClick={saveBrandColor}>{strings.saveBrandColor}</button>
        </div>
        {presets.length > 0 && <div className="preset-list">{presets.slice(-4).map((preset) => (
          <button key={preset.id} onClick={() => isPro ? applySettings(preset.settings) : requestUpgrade()}>{preset.name}</button>
        ))}</div>}
      </section>

      <section className="secondary-actions">
        <button className={`secondary-button ${settings.reversed ? 'is-active' : ''}`} onClick={reverseDirection}><ReverseIcon /> {strings.reverse}</button>
        <button className="secondary-button" onClick={rerandomize}><RandomizeIcon /> {strings.rerandomize}</button>
      </section>

      <p className="apply-hint">{strings.hint}</p>

      {showUpgrade && <UpgradePanel strings={strings} status={entitlement.paymentStatus} onClose={() => setShowUpgrade(false)} onCheckout={() => postToPlugin({ type: 'checkout' })} />}
      {toast && <div className={`toast ${toast.ok ? 'success' : 'error'}`}>{toast.text}</div>}
    </main>
  )
}

function ControlLabel({ children }: { children: React.ReactNode }) { return <div className="control-label">{children}</div> }
function ProTag() { return <span className="pro-tag">PRO</span> }

function StyleButton({ active, label, preview, locked = false, onClick }: { active: boolean; label: string; preview: ArrowStyle; locked?: boolean; onClick: () => void }) {
  return <button aria-pressed={active} className={`style-button ${active ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={onClick}>
    <svg viewBox="0 0 112 40" aria-hidden="true"><path d={stylePreviewPath(preview)} /></svg>
    <span>{label}</span>{locked && <span className="lock-mark">⌑</span>}
  </button>
}

function stylePreviewPath(style: ArrowStyle): string {
  if (style === 'loop') return 'M8 29 C25 8 49 7 53 19 C57 31 36 34 34 20 C32 8 71 6 101 25 M91 16 Q98 20 101 25 M90 31 Q97 27 101 25'
  if (style === 's-curve') return 'M8 28 C28 2 44 12 56 20 C68 28 84 38 101 12'
  if (style === 'wave') return 'M8 24 C20 6 31 38 44 20 C57 2 68 38 81 20 C88 10 95 18 101 25'
  return 'M8 29 C37 4 76 8 101 25 M91 16 Q98 20 101 25 M90 31 Q97 27 101 25'
}

function WidthField({ label, value, labels, onChange }: { label: string; value: number; labels: Record<string, string>; onChange: (value: number) => void }) {
  const options = [
    ['thin', STROKE_WIDTHS.thin],
    ['medium', STROKE_WIDTHS.medium],
    ['thick', STROKE_WIDTHS.thick],
  ] as const
  return <div className="width-field">
    <div className="field-row"><span className="control-label">{label}</span><output>{Math.round(value)} px</output></div>
    <div className="width-options">{options.map(([key, width]) => <button key={key} aria-pressed={value === width} className={`width-option ${value === width ? 'active' : ''}`} onClick={() => onChange(width)}>
      <span className={`width-preview width-${key}`}><i /></span>
      <span>{labels[key]}</span>
    </button>)}</div>
  </div>
}

type OptionPreviewKind = 'pattern' | 'head' | 'head-size' | 'line-style'

function OptionGrid({ values, selected, labels, lockedValues = [], onSelect, onUpgrade, preview }: { values: string[]; selected: string; labels: Record<string, string>; lockedValues?: string[]; onSelect: (value: string) => void; onUpgrade: () => void; preview?: OptionPreviewKind }) {
  return <div className="option-grid option-grid-three">{values.map((value) => {
    const locked = lockedValues.includes(value)
    return <button key={value} aria-pressed={selected === value} className={`option-button ${selected === value ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={() => locked ? onUpgrade() : onSelect(value)}>
      {preview && <OptionPreview kind={preview} value={value} />}
      <span className="option-label">{labels[value]}</span>{locked && <span className="lock-mark">⌑</span>}
    </button>
  })}</div>
}

function OptionPreview({ kind, value }: { kind: OptionPreviewKind; value: string }) {
  if (kind === 'pattern') {
    const dash = value === 'dashed' ? '11 8' : value === 'dotted' ? '1 9' : undefined
    return <svg className="option-preview" viewBox="0 0 64 18" aria-hidden="true"><path d="M5 9 C18 3 32 15 59 7" strokeDasharray={dash} /></svg>
  }
  if (kind === 'line-style') {
    if (value === 'double-drawn') return <svg className="option-preview" viewBox="0 0 64 18" aria-hidden="true"><path d="M4 8 C20 3 37 13 60 7" /><path className="secondary-stroke" d="M4 10 C20 5 38 15 60 9" /></svg>
    const path = value === 'sketch' ? 'M4 10 C14 3 24 13 34 7 C44 3 51 12 60 7' : 'M4 9 C20 4 38 13 60 7'
    return <svg className="option-preview" viewBox="0 0 64 18" aria-hidden="true"><path d={path} /></svg>
  }
  if (kind === 'head-size') {
    const scale = value === 'small' ? 0.72 : value === 'large' ? 1.08 : 0.9
    return <svg className="option-preview head-size-preview" viewBox="0 0 64 18" aria-hidden="true"><path d="M5 9 L43 9" /><path className="solid-head" transform={`translate(49 9) scale(${scale}) translate(-49 -9)`} d="M43 3 L58 9 L43 15 Z" /></svg>
  }
  return <svg className="option-preview head-preview" viewBox="0 0 64 18" aria-hidden="true"><path d={value === 'path' ? 'M6 9 L52 9 M52 9 L43 4 M52 9 L43 14' : 'M6 9 L49 9'} /><path className={value === 'hollow' ? 'hollow-head' : 'solid-head'} d="M49 3 L60 9 L49 15 Z" /></svg>
}

function ColorField({ label, value, brandColors, onChange, onSaveColor, strings }: { label: string; value: RgbColor; brandColors: BrandColor[]; onChange: (value: RgbColor) => void; onSaveColor: () => void; strings: ReturnType<typeof getStrings> }) {
  return <div className="color-field">
    <label className="field-row color-row"><span>{label}</span><span className="color-control"><input type="color" value={rgbToHex(value)} onChange={(event) => onChange(hexToRgb(event.target.value))} /><code>{rgbToHex(value).toUpperCase()}</code></span></label>
    <div className="color-swatches common-swatches">{COMMON_COLORS.map((item) => <button key={item.name} className={sameColor(item.color, value) ? 'active' : ''} title={item.name} aria-label={item.name} style={{ background: rgbToHex(item.color) }} onClick={() => onChange(item.color)} />)}</div>
    {brandColors.length > 0 && <div className="color-swatches brand-swatches">{brandColors.slice(-6).map((brand) => <button key={brand.id} title={brand.name} aria-label={brand.name} style={{ background: rgbToHex(brand.color) }} onClick={() => onChange(brand.color)} />)}<button className="add-swatch" title={strings.saveBrandColor} onClick={onSaveColor}>＋</button></div>}
    {brandColors.length === 0 && <button className="save-color-button" onClick={onSaveColor}>{strings.saveBrandColor}</button>}
    <small>{strings.localOnly}</small>
  </div>
}

function UpgradePanel({ strings, status, onClose, onCheckout }: { strings: ReturnType<typeof getStrings>; status: EntitlementSnapshot['paymentStatus']; onClose: () => void; onCheckout: () => void }) {
  return <div className="upgrade-backdrop"><section className="upgrade-panel"><button className="close-button" onClick={onClose}>×</button><h2>{strings.upgradeTitle}</h2><p>{strings.upgradeDescription}</p><ul><li>{strings.upgradeItems.parameters}</li><li>{strings.upgradeItems.styles}</li><li>{strings.upgradeItems.presets}</li></ul>{status === 'NOT_SUPPORTED' && <p className="upgrade-error">{strings.paymentUnavailable}</p>}<button className="primary-button" disabled={status === 'NOT_SUPPORTED'} onClick={onCheckout}>{strings.upgradeButton}</button></section></div>
}

function ArrowMark() { return <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7 C10 3 17 7 17 13 C17 16 14 18 11 16 C8 14 11 10 15 12 C18 13 19 16 20 19 M16 17 L20 19 L18 14" /></svg> }
function ReverseIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h9M5 2 2 5l3 3M13 11H4m7-3 3 3-3 3" /></svg> }
function RandomizeIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h2.5c3 0 3 8 6.5 8H14M11 9l3 3-3 3M2 12h2.5C7 12 7.5 4 11 4h3M11 1l3 3-3 3" /></svg> }
function postToPlugin(message: UiToPluginMessage) { parent.postMessage({ pluginMessage: message }, '*') }
function rgbToHex(color: RgbColor): string { return `#${[color.r, color.g, color.b].map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0')).join('')}` }
function hexToRgb(hex: string): RgbColor { const value = Number.parseInt(hex.slice(1), 16); return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 } }
function sameColor(first: RgbColor, second: RgbColor): boolean { return Math.abs(first.r - second.r) < 0.01 && Math.abs(first.g - second.g) < 0.01 && Math.abs(first.b - second.b) < 0.01 }

createRoot(document.getElementById('root')!).render(<App />)

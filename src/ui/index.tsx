import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getStatusCopy, getStrings } from './i18n'
import {
  DEFAULT_SETTINGS,
  HEAD_SIZE_SCALES,
  STROKE_WIDTHS,
  type ApplySettingsAction,
  type ArrowSettings,
  type ArrowStyle,
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
const FREE_ENTITLEMENT: EntitlementSnapshot = { tier: 'free', paymentStatus: 'UNPAID', trialRemaining: 0 }
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

type PresetDialogState = {
  mode: 'save' | 'rename'
  presetId?: string
  value: string
}

function App() {
  const systemLocale: Locale = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  const [locale, setLocale] = useState<Locale>(systemLocale)
  const [settings, setSettings] = useState<ArrowSettings>(DEFAULT_SETTINGS)
  const [selection, setSelection] = useState<SelectionSnapshot>(EMPTY_SELECTION)
  const [entitlement, setEntitlement] = useState<EntitlementSnapshot>(FREE_ENTITLEMENT)
  const [presets, setPresets] = useState<UserPreset[]>([])
  const [bootstrapped, setBootstrapped] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [presetDialog, setPresetDialog] = useState<PresetDialogState | null>(null)
  const [showPresetManager, setShowPresetManager] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState('')
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
  const hasProTrial = !isPro && entitlement.trialRemaining > 0
  const hasProControls = isPro || hasProTrial

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
        if (!message.ok && message.code === 'premium-required') setShowUpgrade(true)
        const operationCopy = getStrings(localeRef.current).operation
        const copy = operationCopy[message.code] ?? operationCopy.unexpected
        showFeedback(copy, message.ok)
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
      postToPlugin({ type: 'save-preferences', preferences: { locale, settings, presets } })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [bootstrapped, locale, settings, presets])

  function requestUpgrade() { setShowUpgrade(true) }

  function showFeedback(text: string, ok = true) {
    setToast({ ok, text })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }

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
    if (!hasProControls && key === 'lineStyle' && value !== 'clean') return requestUpgrade()
    if (!hasProControls && key === 'headStyle' && value !== 'solid') return requestUpgrade()
    if (!hasProControls && key === 'strokePattern' && value !== 'solid') return requestUpgrade()
    if (!hasProControls && key === 'style' && value !== 'natural' && value !== 'loop') return requestUpgrade()
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
    setPresetDialog({ mode: 'save', value: `${strings.preset} ${presets.length + 1}` })
  }

  function submitPresetDialog(name: string) {
    const normalizedName = name.trim().slice(0, 80)
    if (!normalizedName) {
      showFeedback(strings.presetNameRequired, false)
      return
    }
    if (!presetDialog) return
    const now = Date.now()
    if (presetDialog.mode === 'save') {
      const preset: UserPreset = {
        id: `preset-${now}-${Math.random().toString(36).slice(2, 7)}`,
        name: normalizedName,
        settings: presetSettings(settings),
        createdAt: now,
        updatedAt: now,
      }
      setPresets((current) => [...current, preset].slice(-30))
      showFeedback(strings.presetSaved)
    } else if (presetDialog.presetId) {
      setPresets((current) => current.map((preset) => preset.id === presetDialog.presetId
        ? { ...preset, name: normalizedName, updatedAt: now }
        : preset))
      showFeedback(strings.presetRenamed)
    }
    setPresetDialog(null)
  }

  function usePreset(preset: UserPreset) {
    if (!isPro) return requestUpgrade()
    applySettings({ ...preset.settings, reversed: settings.reversed })
    showFeedback(strings.presetApplied)
  }

  function selectPreset(presetId: string) {
    if (!presetId) return
    const preset = presets.find((item) => item.id === presetId)
    if (preset) {
      setSelectedPresetId(presetId)
      usePreset(preset)
    }
  }

  function overwritePreset(presetId: string) {
    if (!isPro) return requestUpgrade()
    const now = Date.now()
    setPresets((current) => current.map((preset) => preset.id === presetId
      ? { ...preset, settings: presetSettings(settings), updatedAt: now }
      : preset))
    showFeedback(strings.presetUpdated)
  }

  function renamePreset(preset: UserPreset) {
    if (!isPro) return requestUpgrade()
    setPresetDialog({ mode: 'rename', presetId: preset.id, value: preset.name })
  }

  function deletePreset(presetId: string) {
    if (!isPro) return requestUpgrade()
    setPresets((current) => current.filter((preset) => preset.id !== presetId))
    showFeedback(strings.presetDeleted)
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
          {selection.kind === 'two-nodes' && !isPro && <span className="pro-badge">{strings.pro}</span>}
        </div>
      </section>
      {hasProTrial && <p className="trial-note">{strings.proTrialRemaining.replace('{count}', String(entitlement.trialRemaining))}</p>}

      <section className="control-section presets-section">
        <div className="section-heading">
          <ControlLabel>{strings.presets}</ControlLabel>
          <button className="manager-toggle" onClick={() => setShowPresetManager((current) => !current)}>
            {showPresetManager ? strings.closeManager : strings.manage}
          </button>
        </div>
        <div className="preset-toolbar">
          <PresetSelector
            presets={presets}
            selectedPresetId={selectedPresetId}
            placeholder={strings.selectPreset}
            strings={strings}
            onSelect={selectPreset}
          />
          <button className="secondary-button preset-save-button" onClick={savePreset}>
            <span>{strings.savePreset}</span><span className="button-pro-tag">{strings.pro}</span>
          </button>
        </div>
        {showPresetManager && (
          presets.length === 0
            ? <p className="preset-empty">{strings.presetEmpty}</p>
            : <div className="preset-list">{presets.slice().sort((a, b) => b.updatedAt - a.updatedAt).map((preset) => (
              <article className="preset-card" key={preset.id}>
                <div className="preset-card-heading">
                  <span className="preset-color" style={{ background: rgbToHex(preset.settings.color) }} />
                  <div className="preset-card-copy">
                    <strong>{preset.name}</strong>
                    <small>{presetSummary(preset.settings, strings)}</small>
                  </div>
                </div>
                <div className="preset-card-actions">
                  <button onClick={() => overwritePreset(preset.id)}>{strings.overwritePreset}</button>
                  <button onClick={() => renamePreset(preset)}>{strings.renamePreset}</button>
                  <button className="danger-button" onClick={() => deletePreset(preset.id)}>{strings.deletePreset}</button>
                </div>
              </article>
            ))}</div>
        )}
      </section>

      <section className="control-section">
        <div className="section-heading"><ControlLabel>{strings.pathShape}</ControlLabel></div>
        <div className="style-grid path-grid">
          {PATH_STYLES.map((style) => {
            const locked = !hasProControls && style !== 'natural' && style !== 'loop'
            const pro = style !== 'natural' && style !== 'loop'
            const label = style === 'natural' ? strings.natural : style === 'loop' ? strings.loop : strings.styles[style]
            return <StyleButton
              key={style}
              active={settings.style === style}
              label={label}
              preview={style}
              pro={pro}
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
          onChange={(color) => updateSetting('color', color)}
          strings={strings}
        />
        <WidthField label={strings.strokeWidth} value={settings.strokeWidth} labels={strings.widths} onChange={(value) => updateSetting('strokeWidth', value)} />

        <div>
          <div className="section-heading"><ControlLabel>{strings.headSize}</ControlLabel></div>
          <OptionGrid
            values={['small', 'medium', 'large']}
            selected={settings.headSize}
            labels={strings.headSizes}
            lockedValues={[]}
            onSelect={(value) => updateSetting('headSize', value as HeadSize)}
            onUpgrade={requestUpgrade}
            preview="head-size"
          />
        </div>

        <div>
          <div className="section-heading"><ControlLabel>{strings.strokePattern}</ControlLabel></div>
          <OptionGrid
            values={['solid', 'dashed', 'dotted']}
            selected={settings.strokePattern}
            labels={strings.patterns}
            proValues={['dashed', 'dotted']}
            lockedValues={!hasProControls ? ['dashed', 'dotted'] : []}
            onSelect={(value) => updateSetting('strokePattern', value as StrokePattern)}
            onUpgrade={requestUpgrade}
            preview="pattern"
          />
        </div>

        <div>
          <div className="section-heading"><ControlLabel>{strings.lineStyle}</ControlLabel></div>
          <OptionGrid
            values={['clean', 'sketch', 'double-drawn']}
            selected={settings.lineStyle}
            labels={strings.lineStyles}
            proValues={['sketch', 'double-drawn']}
            lockedValues={!hasProControls ? ['sketch', 'double-drawn'] : []}
            onSelect={(value) => updateSetting('lineStyle', value as LineStyle)}
            onUpgrade={requestUpgrade}
            preview="line-style"
          />
        </div>

        <div>
          <div className="section-heading"><ControlLabel>{strings.headStyle}</ControlLabel></div>
          <OptionGrid
            values={['solid', 'hollow', 'path']}
            selected={settings.headStyle}
            labels={strings.heads}
            proValues={['hollow', 'path']}
            lockedValues={!hasProControls ? ['hollow', 'path'] : []}
            onSelect={(value) => updateSetting('headStyle', value as ArrowSettings['headStyle'])}
            onUpgrade={requestUpgrade}
            preview="head"
          />
        </div>
      </section>

      <section className="secondary-actions">
        <button className={`secondary-button ${settings.reversed ? 'is-active' : ''}`} onClick={reverseDirection}><ReverseIcon /> {strings.reverse}</button>
        <button className="secondary-button" onClick={rerandomize}><RandomizeIcon /> {strings.rerandomize}</button>
      </section>

      <p className="apply-hint">{strings.hint}</p>

      {showUpgrade && <UpgradePanel strings={strings} status={entitlement.paymentStatus} onClose={() => setShowUpgrade(false)} onCheckout={() => postToPlugin({ type: 'checkout' })} />}
      {presetDialog && <PresetDialog strings={strings} state={presetDialog} onClose={() => setPresetDialog(null)} onSubmit={submitPresetDialog} />}
      {toast && <div className={`toast ${toast.ok ? 'success' : 'error'}`}>{toast.text}</div>}
    </main>
  )
}

function ControlLabel({ children }: { children: React.ReactNode }) { return <div className="control-label">{children}</div> }

function PresetSelector({ presets, selectedPresetId, placeholder, strings, onSelect }: { presets: UserPreset[]; selectedPresetId: string; placeholder: string; strings: ReturnType<typeof getStrings>; onSelect: (presetId: string) => void }) {
  const [open, setOpen] = useState(false)
  const selectorRef = useRef<HTMLDivElement>(null)
  const orderedPresets = presets.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  const selectedPreset = orderedPresets.find((preset) => preset.id === selectedPresetId)

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [open])

  function choose(presetId: string) {
    onSelect(presetId)
    setOpen(false)
  }

  return <div className={`preset-selector ${open ? 'is-open' : ''}`} ref={selectorRef}>
    <button className="preset-selector-trigger" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((current) => !current)}>
      {selectedPreset
        ? <PresetOptionContent preset={selectedPreset} strings={strings} />
        : <span className="preset-placeholder">{placeholder}</span>}
      <span className="preset-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="preset-menu" role="listbox">
      {orderedPresets.length === 0
        ? <div className="preset-menu-empty">{placeholder}</div>
        : orderedPresets.map((preset) => (
          <button
            key={preset.id}
            className={`preset-menu-option ${preset.id === selectedPresetId ? 'active' : ''}`}
            role="option"
            aria-selected={preset.id === selectedPresetId}
            onClick={() => choose(preset.id)}
          >
            <PresetOptionContent preset={preset} strings={strings} />
            {preset.id === selectedPresetId && <span className="preset-check" aria-hidden="true">✓</span>}
          </button>
        ))}
    </div>}
  </div>
}

function PresetOptionContent({ preset, strings }: { preset: UserPreset; strings: ReturnType<typeof getStrings> }) {
  return <span className="preset-option-content">
    <span className="preset-option-preview" style={{ color: rgbToHex(preset.settings.color) }}>
      <PresetPreview settings={preset.settings} />
    </span>
    <span className="preset-option-copy">
      <strong>{preset.name}</strong>
      <small>{presetSummary(preset.settings, strings)}</small>
    </span>
  </span>
}

function PresetPreview({ settings }: { settings: ArrowSettings }) {
  const strokeWidth = Math.max(2.5, settings.strokeWidth * 0.68)
  const dashArray = settings.strokePattern === 'dashed' ? '16 9' : settings.strokePattern === 'dotted' ? '2 8' : undefined
  const shaftPath = settings.lineStyle === 'sketch'
    ? sketchPreviewPath(settings.style)
    : previewCenterPath(settings.style)
  const shaftStyle = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeDasharray: dashArray,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return <svg viewBox="0 0 112 40" aria-hidden="true">
    {settings.lineStyle === 'double-drawn' && <path d={offsetPreviewPath(settings.style)} style={{ ...shaftStyle, strokeWidth: strokeWidth * 0.88, opacity: 0.62, transform: 'translate(0.8px, 1px)' }} />}
    <path d={shaftPath} style={shaftStyle} />
    <PresetPreviewHead settings={settings} strokeWidth={strokeWidth} />
  </svg>
}

function PresetPreviewHead({ settings, strokeWidth }: { settings: ArrowSettings; strokeWidth: number }) {
  const scale = previewHeadScale(settings.headSize)
  const transform = `translate(${101 - 101 * scale} ${25 - 25 * scale}) scale(${scale})`
  const headStyle = {
    stroke: 'currentColor',
    strokeWidth: Math.max(1.8, strokeWidth * 0.64),
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: settings.headStyle === 'solid' ? 'currentColor' : 'none',
  }
  const path = settings.headStyle === 'path'
    ? 'M90 17 Q98 21 105 25 Q98 29 90 33'
    : 'M90 16 Q98 20 106 25 Q98 30 90 34 Q94 27 94 25 Q94 21 90 16 Z'
  return <path d={path} transform={transform} style={headStyle} />
}

function previewHeadScale(size: HeadSize): number {
  const previewBase = { small: 0.8, medium: 1, large: 1.2 }[size]
  const previousGeometryBase = { small: 1, medium: 1.2, large: 1.5 }[size]
  return previewBase * (HEAD_SIZE_SCALES[size] / previousGeometryBase)
}

function previewCenterPath(style: ArrowStyle): string {
  if (style === 'loop') return 'M8 29 C25 8 49 7 53 19 C57 31 36 34 34 20 C32 8 71 6 101 25'
  if (style === 's-curve') return 'M8 28 C28 2 44 12 56 20 C68 28 84 38 101 12'
  if (style === 'wave') return 'M8 24 C20 6 31 38 44 20 C57 2 68 38 81 20 C88 10 95 18 101 25'
  return 'M8 29 C37 4 76 8 101 25'
}

function sketchPreviewPath(style: ArrowStyle): string {
  if (style === 'loop') return 'M8 29 C24 9 48 6 53 19 C59 31 37 35 34 20 C32 8 72 7 101 25'
  if (style === 's-curve') return 'M8 28 C27 3 44 11 56 20 C67 29 84 37 101 12'
  if (style === 'wave') return 'M8 24 C20 7 31 37 44 20 C57 3 68 37 81 20 C88 11 95 18 101 25'
  return 'M8 29 C21 7 36 5 49 9 C62 13 76 6 101 25'
}

function offsetPreviewPath(style: ArrowStyle): string {
  if (style === 'loop') return 'M8 30 C25 9 49 8 54 20 C58 32 36 35 34 21 C32 9 72 7 101 26'
  if (style === 's-curve') return 'M8 29 C28 3 44 13 56 21 C68 29 84 39 101 13'
  if (style === 'wave') return 'M8 25 C20 7 31 39 44 21 C57 3 68 39 81 21 C88 11 95 19 101 26'
  return 'M8 30 C37 5 76 9 101 26'
}

function StyleButton({ active, label, preview, pro = false, locked = false, onClick }: { active: boolean; label: string; preview: ArrowStyle; pro?: boolean; locked?: boolean; onClick: () => void }) {
  return <button aria-label={label} title={label} data-tooltip={label} aria-pressed={active} className={`style-button ${active ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={onClick}>
    {pro && <span className="option-pro-tag">PRO</span>}
    <svg viewBox="0 0 112 40" aria-hidden="true"><path d={stylePreviewPath(preview)} /></svg>
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
    <div className="field-row"><span className="control-label">{label}</span></div>
    <div className="width-options">{options.map(([key, width]) => <button key={key} aria-label={labels[key]} title={labels[key]} data-tooltip={labels[key]} aria-pressed={value === width} className={`width-option ${value === width ? 'active' : ''}`} onClick={() => onChange(width)}>
      <span className={`width-preview width-${key}`}><i /></span>
    </button>)}</div>
  </div>
}

type OptionPreviewKind = 'pattern' | 'head' | 'head-size' | 'line-style'

function OptionGrid({ values, selected, labels, lockedValues = [], proValues = [], onSelect, onUpgrade, preview }: { values: string[]; selected: string; labels: Record<string, string>; lockedValues?: string[]; proValues?: string[]; onSelect: (value: string) => void; onUpgrade: () => void; preview?: OptionPreviewKind }) {
  return <div className="option-grid option-grid-three">{values.map((value) => {
    const locked = lockedValues.includes(value)
    return <button key={value} aria-label={labels[value]} title={labels[value]} data-tooltip={labels[value]} aria-pressed={selected === value} className={`option-button ${selected === value ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={() => locked ? onUpgrade() : onSelect(value)}>
      {proValues.includes(value) && <span className="option-pro-tag">PRO</span>}
      {preview && <OptionPreview kind={preview} value={value} />}
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
    const scale = previewHeadScale(value as HeadSize) * 0.9
    return <svg className="option-preview head-size-preview" viewBox="0 0 64 18" aria-hidden="true"><path d="M5 9 L43 9" /><path className="solid-head" transform={`translate(49 9) scale(${scale}) translate(-49 -9)`} d="M43 3 L58 9 L43 15 Z" /></svg>
  }
  return <svg className="option-preview head-preview" viewBox="0 0 64 18" aria-hidden="true"><path d={value === 'path' ? 'M6 9 L52 9 M52 9 L43 4 M52 9 L43 14' : 'M6 9 L49 9'} /><path className={value === 'hollow' ? 'hollow-head' : 'solid-head'} d="M49 3 L60 9 L49 15 Z" /></svg>
}

function ColorField({ label, value, onChange, strings }: { label: string; value: RgbColor; onChange: (value: RgbColor) => void; strings: ReturnType<typeof getStrings> }) {
  return <div className="color-field">
    <label className="field-row color-row"><span>{label}</span><span className="color-control"><input type="color" value={rgbToHex(value)} onChange={(event) => onChange(hexToRgb(event.target.value))} /><code>{rgbToHex(value).toUpperCase()}</code></span></label>
    <div className="color-swatches common-swatches">{COMMON_COLORS.map((item) => <button key={item.name} className={sameColor(item.color, value) ? 'active' : ''} title={item.name} aria-label={item.name} style={{ background: rgbToHex(item.color) }} onClick={() => onChange(item.color)} />)}</div>
    <small>{strings.localOnly}</small>
  </div>
}

function UpgradePanel({ strings, status, onClose, onCheckout }: { strings: ReturnType<typeof getStrings>; status: EntitlementSnapshot['paymentStatus']; onClose: () => void; onCheckout: () => void }) {
  return <div className="upgrade-backdrop"><section className="upgrade-panel"><button className="close-button" onClick={onClose}>×</button><h2>{strings.upgradeTitle}</h2><p>{strings.upgradeDescription}</p><ul><li>{strings.upgradeItems.parameters}</li><li>{strings.upgradeItems.styles}</li><li>{strings.upgradeItems.presets}</li></ul>{status === 'NOT_SUPPORTED' && <p className="upgrade-error">{strings.paymentUnavailable}</p>}<button className="primary-button" disabled={status === 'NOT_SUPPORTED'} onClick={onCheckout}>{strings.upgradeButton}</button></section></div>
}

function PresetDialog({ strings, state, onClose, onSubmit }: { strings: ReturnType<typeof getStrings>; state: PresetDialogState; onClose: () => void; onSubmit: (name: string) => void }) {
  const [value, setValue] = useState(state.value)
  const title = state.mode === 'save' ? strings.presetSaveTitle : strings.presetRenameTitle
  return <div className="preset-dialog-backdrop"><form className="preset-dialog" onSubmit={(event) => { event.preventDefault(); onSubmit(value) }}>
    <button type="button" className="close-button" onClick={onClose}>×</button>
    <h2>{title}</h2>
    <label className="preset-name-label">
      <span>{strings.presetNamePlaceholder}</span>
      <input autoFocus value={value} maxLength={80} onChange={(event) => setValue(event.target.value)} />
    </label>
    <div className="preset-dialog-actions">
      <button type="button" className="secondary-button" onClick={onClose}>{strings.cancel}</button>
      <button type="submit" className="primary-button">{strings.confirm}</button>
    </div>
  </form></div>
}

function ArrowMark() { return <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7 C10 3 17 7 17 13 C17 16 14 18 11 16 C8 14 11 10 15 12 C18 13 19 16 20 19 M16 17 L20 19 L18 14" /></svg> }
function ReverseIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h9M5 2 2 5l3 3M13 11H4m7-3 3 3-3 3" /></svg> }
function RandomizeIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h2.5c3 0 3 8 6.5 8H14M11 9l3 3-3 3M2 12h2.5C7 12 7.5 4 11 4h3M11 1l3 3-3 3" /></svg> }
function postToPlugin(message: UiToPluginMessage) { parent.postMessage({ pluginMessage: message }, '*') }
function rgbToHex(color: RgbColor): string { return `#${[color.r, color.g, color.b].map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0')).join('')}` }
function hexToRgb(hex: string): RgbColor { const value = Number.parseInt(hex.slice(1), 16); return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 } }
function sameColor(first: RgbColor, second: RgbColor): boolean { return Math.abs(first.r - second.r) < 0.01 && Math.abs(first.g - second.g) < 0.01 && Math.abs(first.b - second.b) < 0.01 }
function presetSettings(settings: ArrowSettings): ArrowSettings { return { ...settings, reversed: false } }
function presetSummary(settings: ArrowSettings, strings: ReturnType<typeof getStrings>): string {
  const style = settings.style === 'natural' ? strings.natural : settings.style === 'loop' ? strings.loop : strings.styles[settings.style]
  const width = settings.strokeWidth === STROKE_WIDTHS.thin ? strings.widths.thin : settings.strokeWidth === STROKE_WIDTHS.thick ? strings.widths.thick : strings.widths.medium
  return `${style} · ${width} · ${strings.lineStyles[settings.lineStyle]} · ${strings.heads[settings.headStyle]} · ${strings.patterns[settings.strokePattern]} · ${rgbToHex(settings.color).toUpperCase()}`
}

createRoot(document.getElementById('root')!).render(<App />)

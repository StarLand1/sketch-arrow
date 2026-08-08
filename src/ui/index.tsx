import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getStatusCopy, getStrings } from './i18n'
import {
  DEFAULT_SETTINGS,
  type ArrowSettings,
  type Locale,
  type PluginToUiMessage,
  type RgbColor,
  type SelectionSnapshot,
  type UiToPluginMessage,
} from '../shared/types'

const EMPTY_SELECTION: SelectionSnapshot = {
  kind: 'invalid',
  title: '',
  detail: '',
  nodeNames: [],
}

function App() {
  const systemLocale: Locale = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  const [locale, setLocale] = useState<Locale>(systemLocale)
  const [settings, setSettings] = useState<ArrowSettings>(DEFAULT_SETTINGS)
  const [selection, setSelection] = useState<SelectionSnapshot>(EMPTY_SELECTION)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const localeRef = useRef<Locale>(locale)
  const strings = useMemo(() => getStrings(locale), [locale])
  const [statusTitle, statusDetail] = getStatusCopy(locale, selection.kind)
  const canGenerate = selection.kind === 'line' || selection.kind === 'two-nodes'
  const canUpdate = selection.kind === 'generated-arrow'

  useEffect(() => {
    localeRef.current = locale
  }, [locale])

  useEffect(() => {
    const handler = (event: MessageEvent<{ pluginMessage?: PluginToUiMessage }>) => {
      const message = event.data.pluginMessage
      if (!message) return
      if (message.type === 'bootstrap') {
        setLocale(message.preferences.locale)
        setSelection(message.selection)
        setSettings(message.selection.metadata?.settings ?? message.preferences.settings)
        setBootstrapped(true)
        return
      }
      if (message.type === 'selection') {
        setSelection(message.selection)
        if (message.selection.metadata) setSettings(message.selection.metadata.settings)
        return
      }
      if (message.type === 'operation-result') {
        const copy = getStrings(localeRef.current).operation[message.code]
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
      postToPlugin({ type: 'save-preferences', preferences: { locale, settings } })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [bootstrapped, locale, settings])

  function updateSetting<K extends keyof ArrowSettings>(key: K, value: ArrowSettings[K]) {
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

  function reroll() {
    if (canUpdate) postToPlugin({ type: 'update', settings, reroll: true })
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <ArrowMark />
          <span>{strings.appName}</span>
          <span className="badge">{strings.free}</span>
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
            <div className="node-list">
              {selection.nodeNames.map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}
            </div>
          )}
        </div>
      </section>

      <section className="control-section">
        <ControlLabel>{strings.style}</ControlLabel>
        <div className="style-grid">
          <StyleButton
            active={settings.style === 'natural'}
            label={strings.natural}
            preview="natural"
            onClick={() => updateSetting('style', 'natural')}
          />
          <StyleButton
            active={settings.style === 'loop'}
            label={strings.loop}
            preview="loop"
            onClick={() => updateSetting('style', 'loop')}
          />
        </div>
      </section>

      <section className="control-section settings-grid">
        <label className="field-row color-row">
          <span>{strings.color}</span>
          <span className="color-control">
            <input
              type="color"
              value={rgbToHex(settings.color)}
              onChange={(event) => updateSetting('color', hexToRgb(event.target.value))}
            />
            <code>{rgbToHex(settings.color).toUpperCase()}</code>
          </span>
        </label>
        <RangeField
          label={strings.strokeWidth}
          min={1}
          max={24}
          step={1}
          value={settings.strokeWidth}
          display={`${Math.round(settings.strokeWidth)} px`}
          onChange={(value) => updateSetting('strokeWidth', value)}
        />
        <RangeField
          label={strings.headSize}
          min={0.55}
          max={2}
          step={0.05}
          value={settings.headScale}
          display={`${Math.round(settings.headScale * 100)}%`}
          onChange={(value) => updateSetting('headScale', value)}
        />
        <RangeField
          label={strings.curvature}
          min={-1}
          max={1}
          step={0.02}
          value={settings.curvature}
          display={settings.curvature < 0 ? strings.left : strings.right}
          onChange={(value) => updateSetting('curvature', value)}
        />
        <RangeField
          label={strings.roughness}
          min={0}
          max={1}
          step={0.02}
          value={settings.roughness}
          display={settings.roughness < 0.5 ? strings.subtle : strings.strong}
          onChange={(value) => updateSetting('roughness', value)}
        />
      </section>

      <section className="secondary-actions">
        <button className={`secondary-button ${settings.reversed ? 'is-active' : ''}`} onClick={reverseDirection}>
          <ReverseIcon /> {strings.reverse}
        </button>
        <button className="secondary-button" disabled={!canUpdate} onClick={reroll}>
          <RerollIcon /> {strings.reroll}
        </button>
      </section>

      <footer className="footer-actions">
        <button className="primary-button" disabled={!canGenerate && !canUpdate} onClick={runPrimaryAction}>
          {canUpdate ? strings.update : strings.generate}
        </button>
        <p>{strings.hint}</p>
      </footer>

      {toast && <div className={`toast ${toast.ok ? 'success' : 'error'}`}>{toast.text}</div>}
    </main>
  )
}

function ControlLabel({ children }: { children: React.ReactNode }) {
  return <div className="control-label">{children}</div>
}

function StyleButton({
  active,
  label,
  preview,
  onClick,
}: {
  active: boolean
  label: string
  preview: 'natural' | 'loop'
  onClick: () => void
}) {
  return (
    <button className={`style-button ${active ? 'active' : ''}`} onClick={onClick}>
      <svg viewBox="0 0 112 40" aria-hidden="true">
        {preview === 'natural' ? (
          <path d="M8 29 C37 4 76 8 101 25 M91 16 Q98 20 101 25 M90 31 Q97 27 101 25" />
        ) : (
          <path d="M8 29 C25 8 49 7 53 19 C57 31 36 34 34 20 C32 8 71 6 101 25 M91 16 Q98 20 101 25 M90 31 Q97 27 101 25" />
        )}
      </svg>
      <span>{label}</span>
    </button>
  )
}

function RangeField({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange: (value: number) => void
}) {
  return (
    <label className="range-field">
      <span className="range-heading"><span>{label}</span><output>{display}</output></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function ArrowMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7 C10 3 17 7 17 13 C17 16 14 18 11 16 C8 14 11 10 15 12 C18 13 19 16 20 19 M16 17 L20 19 L18 14" />
    </svg>
  )
}

function ReverseIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5h9M5 2 2 5l3 3M13 11H4m7-3 3 3-3 3" /></svg>
}

function RerollIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 5V2l-2 2a5 5 0 1 0 1.4 5M13 2l1 3h-3" /></svg>
}

function postToPlugin(message: UiToPluginMessage) {
  parent.postMessage({ pluginMessage: message }, '*')
}

function rgbToHex(color: RgbColor): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0'))
    .join('')}`
}

function hexToRgb(hex: string): RgbColor {
  const value = Number.parseInt(hex.slice(1), 16)
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  }
}

createRoot(document.getElementById('root')!).render(<App />)

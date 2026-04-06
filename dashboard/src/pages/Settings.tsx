import { useState, useEffect } from 'react'
import { applyTheme, getTheme } from '../theme'
import type { Theme } from '../theme'
import { ThemePicker } from '../components/ThemePicker'
import { api } from '../api'
import type { KeyName, MaskedKeys, AuthUser } from '../api'

// ── Prompt editor state type ─────────────────────────────────────────────────
// (defined at module level so it can be referenced from component)

// ── Known pricing (USD per 1M tokens) — used for cost estimation ─────────────
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80,  output:  4.00 },
  'claude-sonnet-4-20250514':  { input: 3.00,  output: 15.00 },
  'claude-opus-4-20250514':    { input: 15.00, output: 75.00 },
  'gpt-4o-mini':               { input: 0.15,  output:  0.60 },
  'gpt-4o':                    { input: 2.50,  output: 10.00 },
  'o3-mini':                   { input: 1.10,  output:  4.40 },
  'o1':                        { input: 15.00, output: 60.00 },
  'o1-mini':                   { input: 1.10,  output:  4.40 },
}

// Fallback static lists used before/if API fetch fails
const FALLBACK_CLAUDE = [
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-20250514',  name: 'Claude Sonnet 4' },
  { id: 'claude-opus-4-20250514',    name: 'Claude Opus 4' },
]
const FALLBACK_OPENAI = [
  { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
  { id: 'gpt-4o',      name: 'gpt-4o' },
  { id: 'o3-mini',     name: 'o3-mini' },
  { id: 'o1',          name: 'o1' },
]

const CYCLE_OPTIONS = [
  { value: 1,   label: '1 min' },
  { value: 5,   label: '5 min' },
  { value: 10,  label: '10 min' },
  { value: 15,  label: '15 min' },
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
]

const KEY_LABELS: Record<KeyName, string> = {
  anthropic_api_key: 'ANTHROPIC API KEY',
  openai_api_key:    'OPENAI API KEY',
  alpaca_api_key:    'ALPACA API KEY',
  alpaca_api_secret: 'ALPACA API SECRET',
  alpaca_base_url:   'ALPACA BASE URL',
}

const KEY_ORDER: KeyName[] = ['anthropic_api_key', 'openai_api_key', 'alpaca_api_key', 'alpaca_api_secret', 'alpaca_base_url']

const AVG_INPUT_TOKENS  = 3400
const AVG_OUTPUT_TOKENS = 350

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase()
}

function candidateModelIds(modelId: string): string[] {
  const id = normalizeModelId(modelId)
  const out = new Set<string>([id])
  // OpenAI/Anthropic snapshots often append date/version suffixes.
  out.add(id.replace(/-\d{4}-\d{2}-\d{2}$/, ''))
  out.add(id.replace(/-\d{8}$/, ''))
  out.add(id.replace(/-latest$/, ''))
  return [...out]
}

function getModelPricing(modelId: string): { input: number; output: number } | null {
  const entries = Object.entries(MODEL_PRICING).map(([k, v]) => [normalizeModelId(k), v] as const)
  for (const candidate of candidateModelIds(modelId)) {
    const exact = entries.find(([k]) => k === candidate)
    if (exact) return exact[1]
  }
  // Fallback: match family prefix, preferring the longest key (most specific).
  const id = normalizeModelId(modelId)
  const prefixMatches = entries
    .filter(([k]) => id === k || id.startsWith(`${k}-`))
    .sort((a, b) => b[0].length - a[0].length)
  return prefixMatches[0]?.[1] ?? null
}

function getQrImageUrl(otpauthUrl: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(otpauthUrl)}`
}

function estimateMonthlyCost(modelId: string, cycleMinutes: number): number {
  const pricing = getModelPricing(modelId) ?? { input: 3.00, output: 15.00 }
  const callsPerMonth = (60 / cycleMinutes) * 24 * 30
  return ((AVG_INPUT_TOKENS / 1_000_000) * pricing.input + (AVG_OUTPUT_TOKENS / 1_000_000) * pricing.output) * callsPerMonth
}

function isOpenAIModel(id: string) {
  return id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3')
}

// ── Reusable inputs ───────────────────────────────────────────────────────────
function NumInput({ label, value, onChange, min, max, step = 0.5, unit = '%', help }: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; unit?: string; help?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" value={value} min={min} max={max} step={step}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          style={{ width: 90, padding: '6px 10px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none' }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>{unit}</span>
      </div>
      {help && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', opacity: 0.7 }}>{help}</span>}
    </div>
  )
}

function Select({ label, value, onChange, options, help }: {
  label: string; value: string | number; onChange: (v: any) => void
  options: { value: string | number; label: string }[]; help?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>{label}</label>
      <select value={value} onChange={e => {
        const raw = e.target.value
        onChange(isNaN(Number(raw)) ? raw : Number(raw))
      }} style={{
        padding: '6px 10px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4,
        color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none', cursor: 'pointer',
      }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', opacity: 0.7 }}>{help}</span>}
    </div>
  )
}

// ── API Key row component ─────────────────────────────────────────────────────
function KeyRow({ name, masked, onSave }: { name: KeyName; masked: string; onSave: (name: KeyName, value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  const handleSave = async () => {
    if (!value.trim()) return
    setSaving(true)
    try {
      await onSave(name, value.trim())
      setSaved(true)
      setEditing(false)
      setValue('')
      setTimeout(() => setSaved(false), 3000)
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ minWidth: 170, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>
        {KEY_LABELS[name]}
      </div>
      {editing ? (
        <>
          <input
            type={name === 'alpaca_base_url' ? 'url' : 'password'}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={name === 'alpaca_base_url' ? 'https://paper-api.alpaca.markets' : 'Paste new value...'}
            autoFocus
            style={{
              flex: 1, padding: '6px 10px', background: 'var(--bg3)', border: '1px solid var(--accent)',
              borderRadius: 4, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
            }}
          />
          <button onClick={handleSave} disabled={saving || !value.trim()} style={{
            padding: '6px 14px', background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 4,
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            {saving ? 'SAVING...' : 'SAVE'}
          </button>
          <button onClick={() => { setEditing(false); setValue('') }} style={{
            padding: '6px 10px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border2)',
            borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
          }}>
            CANCEL
          </button>
        </>
      ) : (
        <>
          <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: masked ? 'var(--text)' : 'var(--muted)' }}>
            {masked || '— not set —'}
          </span>
          {saved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)' }}>✓ Saved</span>}
          <button onClick={() => setEditing(true)} style={{
            padding: '5px 12px', background: 'transparent', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb,0,212,170),0.3)',
            borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            {masked ? 'UPDATE' : 'SET'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function Settings() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme())

  const [cfg, setCfg] = useState({
    stopLossPct: 5, takeProfitPct: 10, maxDrawdownPct: 10, maxOpenPositions: 3,
    claudeModel: 'claude-haiku-4-5-20251001', cycleMinutes: 30, marketDataMinutes: 5,
    confidenceThreshold: 0, kellyEnabled: false, consensusMode: false, consensusModel: '',
    costAwareTrading: true, costLookbackCalls: 20, costProfitRatio: 1,
    trailingStopEnabled: false, trailingStopPct: 2.5,
    activeStrategy: 'llm',
    strategyParams: {} as Record<string, Record<string, number | boolean | string>>,
    autoFallbackToLlm: false,
  })

  // Prompt editor state
  const [customPrompt, setCustomPrompt]   = useState<string | null>(null)
  const [promptText, setPromptText]       = useState('')
  const [promptSaving, setPromptSaving]   = useState(false)
  const [promptMsg, setPromptMsg]         = useState<{ ok: boolean; text: string } | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [saveErr, setSaveErr]   = useState<string | null>(null)

  // API keys
  const [keys, setKeys]         = useState<MaskedKeys | null>(null)
  const [keysErr, setKeysErr]   = useState<string | null>(null)

  // Password change
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew]         = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving]   = useState(false)
  const [pwMsg, setPwMsg]         = useState<{ ok: boolean; text: string } | null>(null)
  const [me, setMe]               = useState<AuthUser | null>(null)
  const [twoFaSetup, setTwoFaSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [twoFaCode, setTwoFaCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [twoFaMsg, setTwoFaMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [twoFaLoading, setTwoFaLoading] = useState(false)

  // Provider + dynamic model list
  const [provider, setProvider]       = useState<'claude' | 'openai'>('claude')
  const [modelList, setModelList]     = useState<{ id: string; name: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)

  const loadModels = async (p: 'claude' | 'openai') => {
    setModelsLoading(true)
    setModelsError(null)
    try {
      const { models } = await api.fetchModels(p)
      setModelList(models)
    } catch (e: any) {
      setModelsError(e.message)
      setModelList(p === 'openai' ? FALLBACK_OPENAI : FALLBACK_CLAUDE)
    } finally {
      setModelsLoading(false)
    }
  }

  useEffect(() => {
    Promise.all([
      api.getConfig(),
      api.getKeys(),
      api.me().catch(() => ({ user: null as AuthUser | null })),
    ]).then(([c, k, meRes]) => {
      const det = isOpenAIModel(c.claudeModel ?? '') ? 'openai' : 'claude'
      setProvider(det)
      setCfg({
        stopLossPct:          c.stopLossPct          ?? 5,
        takeProfitPct:        c.takeProfitPct        ?? 10,
        maxDrawdownPct:       c.maxDrawdownPct        ?? 10,
        maxOpenPositions:     c.maxOpenPositions      ?? 3,
        claudeModel:          c.claudeModel           ?? 'claude-haiku-4-5-20251001',
        cycleMinutes:         c.cycleMinutes          ?? 30,
        marketDataMinutes:    c.marketDataMinutes     ?? 5,
        confidenceThreshold:  c.confidenceThreshold   ?? 0,
        kellyEnabled:         c.kellyEnabled          ?? false,
        consensusMode:        c.consensusMode         ?? false,
        consensusModel:       c.consensusModel        ?? '',
        costAwareTrading:     c.costAwareTrading      ?? true,
        costLookbackCalls:    c.costLookbackCalls     ?? 20,
        costProfitRatio:      c.costProfitRatio       ?? 1,
        trailingStopEnabled:  c.trailingStopEnabled   ?? false,
        trailingStopPct:      c.trailingStopPct       ?? 2.5,
        activeStrategy:       c.activeStrategy        ?? 'llm',
        strategyParams:       c.strategyParams        ?? {},
        autoFallbackToLlm:    c.autoFallbackToLlm     ?? false,
      })
      setKeys(k)
      setMe(meRes.user)
      loadModels(det)
    }).catch(e => setKeysErr(e.message))
      .finally(() => setLoading(false))

    // Load custom prompt
    api.getPrompt().then(({ systemPrompt }) => {
      if (systemPrompt) { setCustomPrompt(systemPrompt); setPromptText(systemPrompt) }
    }).catch(() => {})
  }, [])

  const patch = (key: keyof typeof cfg) => (v: any) => setCfg(prev => ({ ...prev, [key]: v }))

  const handleSavePrompt = async () => {
    setPromptSaving(true); setPromptMsg(null)
    try {
      await api.setPrompt(promptText)
      setCustomPrompt(promptText)
      setPromptMsg({ ok: true, text: 'Prompt saved' })
      setTimeout(() => setPromptMsg(null), 3000)
    } catch (e: any) {
      setPromptMsg({ ok: false, text: e.message || 'Failed to save prompt' })
    } finally { setPromptSaving(false) }
  }

  const handleResetPrompt = async () => {
    setPromptSaving(true); setPromptMsg(null)
    try {
      await api.deletePrompt()
      setCustomPrompt(null); setPromptText('')
      setPromptMsg({ ok: true, text: 'Prompt reset to default' })
      setTimeout(() => setPromptMsg(null), 3000)
    } catch (e: any) {
      setPromptMsg({ ok: false, text: e.message || 'Failed to reset prompt' })
    } finally { setPromptSaving(false) }
  }

  const handleSave = async () => {
    setSaving(true); setSaveErr(null); setSaved(false)
    try {
      await api.setRiskConfig(cfg)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setSaveErr(e.message || 'Failed to save')
    } finally { setSaving(false) }
  }

  const handleKeyUpdate = async (name: KeyName, value: string) => {
    await api.setKey(name, value)
    setKeys(prev => prev ? { ...prev, [name]: name === 'alpaca_base_url' ? value : `***${value.slice(-4)}` } : prev)
  }

  const handlePasswordChange = async () => {
    setPwMsg(null)
    if (pwNew !== pwConfirm) { setPwMsg({ ok: false, text: 'New passwords do not match' }); return }
    if (pwNew.length < 6)    { setPwMsg({ ok: false, text: 'Password must be at least 6 characters' }); return }
    setPwSaving(true)
    try {
      await api.changePassword(pwCurrent, pwNew)
      setPwMsg({ ok: true, text: 'Password changed successfully' })
      setPwCurrent(''); setPwNew(''); setPwConfirm('')
    } catch (e: any) {
      setPwMsg({ ok: false, text: e.message || 'Failed to change password' })
    } finally { setPwSaving(false) }
  }

  const handleStart2fa = async () => {
    setTwoFaMsg(null)
    setTwoFaLoading(true)
    try {
      const setup = await api.start2faSetup()
      setTwoFaSetup(setup)
      setTwoFaCode('')
      setTwoFaMsg({ ok: true, text: '2FA secret generated. Add it in your authenticator, then confirm code.' })
    } catch (e: any) {
      setTwoFaMsg({ ok: false, text: e.message || 'Failed to start 2FA setup' })
    } finally {
      setTwoFaLoading(false)
    }
  }

  const handleVerify2fa = async () => {
    if (!twoFaCode || twoFaCode.length !== 6) {
      setTwoFaMsg({ ok: false, text: 'Enter a valid 6-digit code' })
      return
    }
    setTwoFaMsg(null)
    setTwoFaLoading(true)
    try {
      await api.verify2faSetup(twoFaCode)
      const meRes = await api.me()
      setMe(meRes.user)
      setTwoFaSetup(null)
      setTwoFaCode('')
      setTwoFaMsg({ ok: true, text: '2FA enabled successfully' })
    } catch (e: any) {
      setTwoFaMsg({ ok: false, text: e.message || '2FA verification failed' })
    } finally {
      setTwoFaLoading(false)
    }
  }

  const handleDisable2fa = async () => {
    if (!disablePassword || !disableCode) {
      setTwoFaMsg({ ok: false, text: 'Password and authenticator code are required' })
      return
    }
    setTwoFaMsg(null)
    setTwoFaLoading(true)
    try {
      await api.disable2fa(disablePassword, disableCode)
      const meRes = await api.me()
      setMe(meRes.user)
      setDisablePassword('')
      setDisableCode('')
      setTwoFaSetup(null)
      setTwoFaMsg({ ok: true, text: '2FA disabled' })
    } catch (e: any) {
      setTwoFaMsg({ ok: false, text: e.message || 'Failed to disable 2FA' })
    } finally {
      setTwoFaLoading(false)
    }
  }

  const monthlyCost   = estimateMonthlyCost(cfg.claudeModel, cfg.cycleMinutes)
  const pricing       = getModelPricing(cfg.claudeModel)
  const selectedModel = modelList.find(m => m.id === cfg.claudeModel)

  const pwInputStyle: React.CSSProperties = {
    flex: 1, padding: '6px 10px', background: 'var(--bg3)', border: '1px solid var(--border2)',
    borderRadius: 4, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none',
  }

  return (
    <div style={{ padding: '28px', maxWidth: 780, margin: '0 auto' }}>

      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--accent)', marginBottom: 6 }}>SETTINGS</h2>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Agent configuration, risk limits and dashboard preferences.</p>
      </div>

      {/* ── API Keys ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 16 }}>API KEYS</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 20px 16px' }}>
          {loading ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', padding: '12px 0' }}>Loading...</div>
          ) : keysErr ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)', padding: '12px 0' }}>{keysErr}</div>
          ) : keys ? (
            <>
              {KEY_ORDER.map(name => (
                <KeyRow key={name} name={name} masked={keys[name]} onSave={handleKeyUpdate} />
              ))}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 12, lineHeight: 1.6, opacity: 0.7 }}>
                Keys are stored encrypted in MongoDB. Environment variables take precedence if set.
              </div>
            </>
          ) : null}
        </div>
      </section>

      {/* ── LLM Provider & Model ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 16 }}>LLM MODEL &amp; CYCLE</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          {loading ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading...</div> : (<>

            {/* Provider toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center' }}>
              {(['claude', 'openai'] as const).map(p => (
                <button key={p} onClick={() => {
                  setProvider(p)
                  loadModels(p)
                  const fallback = p === 'openai' ? FALLBACK_OPENAI[0] : FALLBACK_CLAUDE[0]
                  patch('claudeModel')(fallback.id)
                }} style={{
                  padding: '7px 20px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11,
                  fontWeight: provider === p ? 700 : 400, cursor: 'pointer',
                  background: provider === p ? 'var(--accent)' : 'var(--bg3)',
                  color: provider === p ? '#000' : 'var(--muted)',
                  border: `1px solid ${provider === p ? 'var(--accent)' : 'var(--border2)'}`,
                  letterSpacing: '0.06em',
                }}>
                  {p === 'claude' ? 'Anthropic Claude' : 'OpenAI'}
                </button>
              ))}
              <button
                onClick={() => loadModels(provider)}
                disabled={modelsLoading}
                title="Refresh model list from API"
                style={{
                  marginLeft: 4, padding: '7px 10px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 13,
                  background: 'transparent', color: modelsLoading ? 'var(--muted)' : 'var(--accent)',
                  border: '1px solid var(--border2)', cursor: modelsLoading ? 'wait' : 'pointer',
                }}
              >
                ↻
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              <Select
                label="CYCLE INTERVAL"
                value={cfg.cycleMinutes}
                onChange={patch('cycleMinutes')}
                options={CYCLE_OPTIONS}
                help="How often LLM-driven decision cycles run"
              />
              <Select
                label="ALPACA DATA INTERVAL"
                value={cfg.marketDataMinutes}
                onChange={patch('marketDataMinutes')}
                options={CYCLE_OPTIONS}
                help="How often Alpaca market/account data is refreshed; pure rule strategies can use this tighter interval"
              />
            </div>

            {/* Cost estimate */}
            <div style={{
              background: monthlyCost < 5 ? 'rgba(34,197,94,0.07)' : monthlyCost < 20 ? 'rgba(245,158,11,0.07)' : 'rgba(239,68,68,0.07)',
              border: `1px solid ${monthlyCost < 5 ? 'var(--green)' : monthlyCost < 20 ? 'var(--warn)' : 'var(--danger)'}`,
              borderRadius: 6, padding: '12px 16px', marginBottom: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
            }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 4 }}>
                  ESTIMATED MONTHLY API COST
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700,
                  color: monthlyCost < 5 ? 'var(--green)' : monthlyCost < 20 ? 'var(--warn)' : 'var(--danger)',
                }}>
                  ${monthlyCost.toFixed(2)} / month
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                  ≈ {(60 / cfg.cycleMinutes * 24 * 30).toFixed(0)} calls/month · ~{AVG_INPUT_TOKENS.toLocaleString()} in + ~{AVG_OUTPUT_TOKENS} out tokens per call
                </div>
              </div>
              {pricing && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                  {selectedModel?.name ?? cfg.claudeModel} · ${pricing.input}/${pricing.output} per 1M
                </div>
              )}
            </div>

            {/* Model list */}
            {modelsLoading ? (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', padding: '16px 0', textAlign: 'center' }}>
                Fetching models from API...
              </div>
            ) : (
              <>
                {modelsError && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--warn)', marginBottom: 8 }}>
                    ⚠ Could not fetch live models ({modelsError}) — showing fallback list
                  </div>
                )}
                <div style={{ background: 'var(--bg3)', borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden', maxHeight: 360, overflowY: 'auto' }}>
                  {modelList.map((m, i, arr) => {
                    const est       = estimateMonthlyCost(m.id, cfg.cycleMinutes)
                    const p         = getModelPricing(m.id)
                    const isSelected = m.id === cfg.claudeModel
                    return (
                      <div key={m.id} onClick={() => patch('claudeModel')(m.id)} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 14px', cursor: 'pointer',
                        background: isSelected ? 'rgba(var(--accent-rgb,0,212,170),0.08)' : 'transparent',
                        borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                        transition: 'background 0.1s',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: isSelected ? 'var(--accent)' : 'var(--border2)' }} />
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: isSelected ? 'var(--accent)' : 'var(--text)', fontWeight: isSelected ? 700 : 400 }}>
                            {m.name}
                          </span>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          {p ? (
                            <>
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: est < 5 ? 'var(--green)' : est < 20 ? 'var(--warn)' : 'var(--danger)', fontWeight: 600 }}>
                                ~${est.toFixed(2)}/mo
                              </div>
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
                                ${p.input}/${p.output} per 1M
                              </div>
                            </>
                          ) : (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>pricing varies</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>)}
        </div>
      </section>

      {/* ── Active Strategy ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 16 }}>ACTIVE STRATEGY</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          {loading ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading...</div> : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>
                  STRATEGY
                </label>
                <select
                  value={cfg.activeStrategy}
                  onChange={async e => {
                    const id = e.target.value
                    patch('activeStrategy')(id)
                    try { await api.setActiveStrategy(id) } catch (_) {}
                  }}
                  style={{
                    padding: '6px 10px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4,
                    color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none', cursor: 'pointer',
                    maxWidth: 260,
                  }}
                >
                  {(['llm', 'momentum', 'meanReversion', 'breakout', 'trendFollowing', 'auto'] as const).map(id => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
                Quick-select only. Configure parameters in the{' '}
                <span style={{ color: 'var(--accent)', cursor: 'default' }}>Strategies page</span>.
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── Risk management ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 16 }}>RISK MANAGEMENT</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          {loading ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading...</div> : (<>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 20, marginBottom: 20 }}>
              <NumInput label="STOP LOSS"           value={cfg.stopLossPct}      onChange={patch('stopLossPct')}      min={0.5}  max={50}  step={0.5} help="Close if price drops this % from entry" />
              <NumInput label="TAKE PROFIT"         value={cfg.takeProfitPct}    onChange={patch('takeProfitPct')}    min={0.5}  max={200} step={0.5} help="Close if price rises this % from entry" />
              <NumInput label="MAX DAILY DRAWDOWN"  value={cfg.maxDrawdownPct}   onChange={patch('maxDrawdownPct')}   min={1}    max={100} step={1}   help="Circuit breaker daily equity drop limit" />
              <NumInput label="MAX OPEN POSITIONS"  value={cfg.maxOpenPositions} onChange={patch('maxOpenPositions')} min={1}    max={20}  step={1}   unit="pos" help="Refuse new buys above this limit" />
            </div>
            <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid var(--border2)', borderRadius: 6, padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
              SL/TP checked every 2 min. Circuit breaker resets daily at midnight UTC. Changes take effect on the next cycle.
            </div>

            {/* Trailing Stop */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid var(--border)', marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>Trailing Stop</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Stop loss that follows price up; triggers when price drops X% from its high</div>
              </div>
              <button
                onClick={() => patch('trailingStopEnabled')(!cfg.trailingStopEnabled)}
                style={{
                  position: 'relative', width: 44, height: 24, borderRadius: 12, padding: 0, flexShrink: 0,
                  background: cfg.trailingStopEnabled ? 'var(--accent)' : 'var(--bg3)',
                  border: `1px solid ${cfg.trailingStopEnabled ? 'var(--accent)' : 'var(--border2)'}`,
                  transition: 'background 0.2s, border-color 0.2s', cursor: 'pointer',
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: cfg.trailingStopEnabled ? 22 : 3,
                  width: 16, height: 16, borderRadius: '50%',
                  background: cfg.trailingStopEnabled ? '#000' : 'var(--muted)',
                  transition: 'left 0.2s', display: 'block',
                }} />
              </button>
            </div>
            {cfg.trailingStopEnabled && (
              <div style={{ padding: '0 0 12px' }}>
                <NumInput label="TRAILING STOP %" value={cfg.trailingStopPct} onChange={patch('trailingStopPct')} min={0.5} max={20} step={0.5} help="Sell when price drops this % from its highest point since entry" />
              </div>
            )}
          </>)}
        </div>
      </section>

      {/* ── Agent Behavior ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 16 }}>AGENT BEHAVIOR</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          {loading ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading...</div> : (<>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 20, marginBottom: 20 }}>
              <NumInput
                label="CONFIDENCE THRESHOLD"
                value={cfg.confidenceThreshold}
                onChange={patch('confidenceThreshold')}
                min={0} max={1} step={0.05} unit=""
                help="Skip trades below this confidence (0 = disabled)"
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>Cost-Aware Trading</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Require expected trade edge to beat recent average LLM cost</div>
              </div>
              <button
                onClick={() => patch('costAwareTrading')(!cfg.costAwareTrading)}
                style={{
                  position: 'relative', width: 44, height: 24, borderRadius: 12, padding: 0, flexShrink: 0,
                  background: cfg.costAwareTrading ? 'var(--accent)' : 'var(--bg3)',
                  border: `1px solid ${cfg.costAwareTrading ? 'var(--accent)' : 'var(--border2)'}`,
                  transition: 'background 0.2s, border-color 0.2s', cursor: 'pointer',
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: cfg.costAwareTrading ? 22 : 3,
                  width: 16, height: 16, borderRadius: '50%',
                  background: cfg.costAwareTrading ? '#000' : 'var(--muted)',
                  transition: 'left 0.2s', display: 'block',
                }} />
              </button>
            </div>

            {cfg.costAwareTrading && (
              <div style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 20 }}>
                  <NumInput
                    label="COST LOOKBACK"
                    value={cfg.costLookbackCalls}
                    onChange={patch('costLookbackCalls')}
                    min={1} max={200} step={1} unit="calls"
                    help="Rolling window used to average recent model spend"
                  />
                  <NumInput
                    label="MIN PROFIT / COST"
                    value={cfg.costProfitRatio}
                    onChange={patch('costProfitRatio')}
                    min={0.25} max={20} step={0.25} unit="x"
                    help="Expected gross profit must exceed average LLM cost by this multiple"
                  />
                </div>
              </div>
            )}

            {/* Kelly Criterion toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>Kelly Criterion Sizing</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Scale position size by Kelly formula based on win rate and payoff ratio</div>
              </div>
              <button
                onClick={() => patch('kellyEnabled')(!cfg.kellyEnabled)}
                style={{
                  position: 'relative', width: 44, height: 24, borderRadius: 12, padding: 0, flexShrink: 0,
                  background: cfg.kellyEnabled ? 'var(--accent)' : 'var(--bg3)',
                  border: `1px solid ${cfg.kellyEnabled ? 'var(--accent)' : 'var(--border2)'}`,
                  transition: 'background 0.2s, border-color 0.2s', cursor: 'pointer',
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: cfg.kellyEnabled ? 22 : 3,
                  width: 16, height: 16, borderRadius: '50%',
                  background: cfg.kellyEnabled ? '#000' : 'var(--muted)',
                  transition: 'left 0.2s', display: 'block',
                }} />
              </button>
            </div>

            {/* Consensus Mode toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>Consensus Mode</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Agent will only trade when both models agree on direction</div>
              </div>
              <button
                onClick={() => patch('consensusMode')(!cfg.consensusMode)}
                style={{
                  position: 'relative', width: 44, height: 24, borderRadius: 12, padding: 0, flexShrink: 0,
                  background: cfg.consensusMode ? 'var(--accent)' : 'var(--bg3)',
                  border: `1px solid ${cfg.consensusMode ? 'var(--accent)' : 'var(--border2)'}`,
                  transition: 'background 0.2s, border-color 0.2s', cursor: 'pointer',
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: cfg.consensusMode ? 22 : 3,
                  width: 16, height: 16, borderRadius: '50%',
                  background: cfg.consensusMode ? '#000' : 'var(--muted)',
                  transition: 'left 0.2s', display: 'block',
                }} />
              </button>
            </div>

            {/* Consensus model input — only shown when consensus mode is on */}
            {cfg.consensusMode && (
              <div style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                  CONSENSUS MODEL ID
                </label>
                <input
                  type="text"
                  value={cfg.consensusModel}
                  onChange={e => patch('consensusModel')(e.target.value)}
                  placeholder="e.g. gpt-4o or claude-sonnet-4-20250514"
                  style={{
                    width: '100%', padding: '6px 10px', background: 'var(--bg3)',
                    border: '1px solid var(--border2)', borderRadius: 4,
                    color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}
          </>)}
        </div>
      </section>

      {/* ── System Prompt ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 16 }}>SYSTEM PROMPT</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          {customPrompt === null ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                Using default system prompt
              </span>
              <button
                onClick={() => { setCustomPrompt(''); setPromptText('') }}
                style={{
                  padding: '7px 18px', background: 'transparent', color: 'var(--accent)',
                  border: '1px solid rgba(var(--accent-rgb,0,212,170),0.3)', borderRadius: 4,
                  fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
                }}
              >
                Customize
              </button>
            </div>
          ) : (
            <>
              <textarea
                value={promptText}
                onChange={e => setPromptText(e.target.value)}
                placeholder="Enter custom system prompt for the trading agent..."
                style={{
                  width: '100%', height: 200, fontFamily: 'var(--font-mono)', fontSize: 11,
                  background: 'var(--bg3)', color: 'var(--text)',
                  border: '1px solid var(--border2)', borderRadius: 4,
                  padding: 12, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <button
                  onClick={handleSavePrompt}
                  disabled={promptSaving || !promptText.trim()}
                  style={{
                    padding: '7px 18px', background: 'var(--accent)', color: '#000',
                    border: 'none', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11,
                    fontWeight: 700, cursor: promptSaving ? 'wait' : 'pointer', opacity: promptSaving ? 0.7 : 1,
                  }}
                >
                  {promptSaving ? 'SAVING...' : 'SAVE PROMPT'}
                </button>
                <button
                  onClick={handleResetPrompt}
                  disabled={promptSaving}
                  style={{
                    padding: '7px 14px', background: 'transparent', color: 'var(--danger)',
                    border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4,
                    fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  RESET TO DEFAULT
                </button>
                {promptMsg && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: promptMsg.ok ? 'var(--green)' : 'var(--danger)' }}>
                    {promptMsg.ok ? '✓' : '✗'} {promptMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── Save button ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 36 }}>
        <button onClick={handleSave} disabled={saving || loading} style={{
          padding: '9px 24px', background: 'var(--accent)', color: '#000',
          border: 'none', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
          cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1, letterSpacing: '0.06em',
        }}>
          {saving ? 'SAVING...' : 'SAVE ALL SETTINGS'}
        </button>
        {saved   && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)' }}>✓ Saved — cycle interval takes effect after the next run</span>}
        {saveErr && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)' }}>✗ {saveErr}</span>}
      </div>

      {/* ── Security ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 16 }}>SECURITY</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', marginBottom: 16 }}>
            Change Password {me ? `(${me.username})` : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'CURRENT PASSWORD', value: pwCurrent, set: setPwCurrent },
              { label: 'NEW PASSWORD',     value: pwNew,     set: setPwNew },
              { label: 'CONFIRM NEW',      value: pwConfirm, set: setPwConfirm },
            ].map(({ label, value, set }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ minWidth: 160, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>{label}</span>
                <input type="password" value={value} onChange={e => set(e.target.value)} style={pwInputStyle} />
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <button onClick={handlePasswordChange} disabled={pwSaving || !pwCurrent || !pwNew || !pwConfirm} style={{
                padding: '8px 20px', background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 4,
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.06em',
                opacity: pwSaving ? 0.7 : 1,
              }}>
                {pwSaving ? 'SAVING...' : 'CHANGE PASSWORD'}
              </button>
              {pwMsg && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: pwMsg.ok ? 'var(--green)' : 'var(--danger)' }}>
                  {pwMsg.ok ? '✓' : '✗'} {pwMsg.text}
                </span>
              )}
            </div>
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', marginBottom: 8 }}>
              Two-Factor Authentication (Authenticator App)
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 12 }}>
              Status: {me?.twoFactorEnabled ? 'ENABLED' : 'DISABLED'}
            </div>

            {!me?.twoFactorEnabled && (
              <>
                {!twoFaSetup ? (
                  <button onClick={handleStart2fa} disabled={twoFaLoading} style={{
                    padding: '8px 18px', background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 4,
                    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    opacity: twoFaLoading ? 0.7 : 1,
                  }}>
                    {twoFaLoading ? 'PREPARING...' : 'SETUP 2FA'}
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
                      <img
                        src={getQrImageUrl(twoFaSetup.otpauthUrl)}
                        alt="Scan this QR with your authenticator app"
                        width={220}
                        height={220}
                        style={{ borderRadius: 8, border: '1px solid var(--border2)', background: '#fff', padding: 6 }}
                      />
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                      Scan QR with Google Authenticator, Authy, or Microsoft Authenticator.
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.5, opacity: 0.8 }}>
                      If QR does not load, use the manual secret below.
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                      Add this secret into your authenticator app:
                      <br />
                      <span style={{ color: 'var(--text)' }}>{twoFaSetup.secret}</span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                      OTPAuth URL:
                      <br />
                      <span style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{twoFaSetup.otpauthUrl}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\d{6}"
                        maxLength={6}
                        value={twoFaCode}
                        onChange={e => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code"
                        style={{ ...pwInputStyle, maxWidth: 160 }}
                      />
                      <button onClick={handleVerify2fa} disabled={twoFaLoading || twoFaCode.length !== 6} style={{
                        padding: '8px 14px', background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 4,
                        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        opacity: twoFaLoading ? 0.7 : 1,
                      }}>
                        {twoFaLoading ? 'VERIFYING...' : 'VERIFY & ENABLE'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {me?.twoFactorEnabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ minWidth: 160, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>PASSWORD</span>
                  <input type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} style={pwInputStyle} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ minWidth: 160, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>AUTH CODE</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={disableCode}
                    onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    style={pwInputStyle}
                  />
                </div>
                <div>
                  <button onClick={handleDisable2fa} disabled={twoFaLoading || !disablePassword || disableCode.length !== 6} style={{
                    padding: '8px 18px', background: 'transparent', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4,
                    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    opacity: twoFaLoading ? 0.7 : 1,
                  }}>
                    {twoFaLoading ? 'DISABLING...' : 'DISABLE 2FA'}
                  </button>
                </div>
              </div>
            )}

            {twoFaMsg && (
              <div style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: twoFaMsg.ok ? 'var(--green)' : 'var(--danger)' }}>
                {twoFaMsg.ok ? '[OK]' : '[ERR]'} {twoFaMsg.text}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Theme ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 14 }}>THEME</div>
        <ThemePicker
          value={currentTheme}
          onChange={(theme) => {
            applyTheme(theme)
            setCurrentTheme(theme)
          }}
        />
      </section>

      <div style={{ margin: '32px 0', borderTop: '1px solid var(--border)' }} />

      {/* ── About ── */}
      <section>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 14 }}>ABOUT</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {[
            { label: 'Dashboard',   value: 'React + Vite + Recharts' },
            { label: 'Agent',       value: 'Node.js + TypeScript' },
            { label: 'LLM',         value: 'Anthropic Claude · OpenAI GPT/O-series (configurable)' },
            { label: 'Database',    value: 'MongoDB' },
            { label: 'Broker',      value: 'Alpaca Paper Trading' },
            { label: 'Data',        value: 'Alpaca Crypto Bars + News · alternative.me F&G' },
            { label: 'Risk',        value: 'ATR sizing · SL/TP monitor · Circuit breaker' },
          ].map((row, i, arr) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{row.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>{row.value}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

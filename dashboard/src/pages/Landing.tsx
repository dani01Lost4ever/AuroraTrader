import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { applyTheme, getTheme } from '../theme'
import type { HealthStatus, LivePrices } from '../api'
import type { Theme } from '../theme'
import { ThemePicker } from '../components/ThemePicker'

interface LandingProps {
  onEnter: () => void
}

export function Landing({ onEnter }: LandingProps) {
  const [theme, setTheme] = useState<Theme>(() => getTheme())
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [prices, setPrices] = useState<LivePrices | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => {})
    api.livePrices().then(setPrices).catch(() => {})
  }, [])

  const featured = useMemo(() => Object.entries(prices ?? {}).slice(0, 8), [prices])
  const tape = featured.length > 0 ? [...featured, ...featured] : []

  return (
    <div className="landing-shell" style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden', padding: '22px 18px 30px' }}>
      <div className="landing-bg-orb landing-bg-orb-a" />
      <div className="landing-bg-orb landing-bg-orb-b" />
      <div className="landing-bg-orb landing-bg-orb-c" />
      <div className="landing-bg-grid" />

      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        <header style={{
          background: 'color-mix(in srgb, var(--bg2) 88%, transparent)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(6px)',
          borderRadius: 12,
          padding: '12px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 16px var(--accent)' }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em', color: 'var(--text)' }}>
              tradingAI
            </div>
            <Pill label={health?.status === 'ok' ? 'SYSTEM READY' : 'SYSTEM CHECKING'} tone={health?.status === 'ok' ? 'ok' : 'neutral'} />
            <Pill label={health?.alpacaKeySet ? 'ALPACA LINKED' : 'ALPACA OFFLINE'} tone={health?.alpacaKeySet ? 'ok' : 'warn'} />
          </div>
          <button
            onClick={onEnter}
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid var(--accent)',
              background: 'linear-gradient(130deg, var(--accent), color-mix(in srgb, var(--accent) 75%, #fff 25%))',
              color: '#000',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              letterSpacing: '0.08em',
              fontSize: 10,
            }}
          >
            OPEN LOGIN
          </button>
        </header>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div style={{
            background: 'linear-gradient(160deg, color-mix(in srgb, var(--bg2) 92%, transparent), color-mix(in srgb, var(--bg3) 84%, transparent))',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: '20px 18px',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 11, letterSpacing: '0.12em', marginBottom: 10 }}>
              AI TRADING STUDIO
            </div>
            <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: 'clamp(1.65rem, 4.4vw, 3rem)', lineHeight: 1.06, marginBottom: 12 }}>
              Design strategies, inspect risk, and control LLM spend.
            </h1>
            <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontSize: 11, lineHeight: 1.75, marginBottom: 14 }}>
              A paper-trading cockpit combining Alpaca market feeds, deterministic engines, and model-driven decisions with approval workflows and cost telemetry.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              <Badge text="Rule + LLM Hybrid" />
              <Badge text="Auto / Manual Execution" />
              <Badge text="Cost-Aware Decisions" />
              <Badge text="Backtests + Dataset Export" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              <MiniMetric label="MongoDB" value={health?.mongodb ? 'ONLINE' : 'CHECK'} />
              <MiniMetric label="Cycle" value={health?.lastCycleAt ? 'ACTIVE' : 'IDLE'} />
              <MiniMetric label="Providers" value={health ? `${Number(health.anthropicKeySet) + Number(health.openaiKeySet)}` : '0'} />
            </div>
          </div>

          <SignalCanvas prices={featured} />
        </section>

        <section style={{
          background: 'color-mix(in srgb, var(--bg2) 88%, transparent)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
          marginBottom: 14,
        }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>
            MARKET TAPE
          </div>
          {tape.length === 0 ? (
            <div style={{ padding: '12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Waiting for live prices...</div>
          ) : (
            <div className="landing-tape-track">
              {tape.map(([asset, row], i) => (
                <div key={`${asset}-${i}`} className="landing-tape-item">
                  <span>{asset}</span>
                  <span>${row.price.toFixed(2)}</span>
                  <span style={{ color: row.change24h >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                    {row.change24h >= 0 ? '+' : ''}{row.change24h.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 10 }}>SYSTEM SNAPSHOT</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <StatRow label="Status" value={health?.status?.toUpperCase() ?? 'CHECKING'} tone={health?.status === 'ok' ? 'ok' : 'neutral'} />
              <StatRow label="Broker" value={health?.alpacaKeySet ? 'CONNECTED' : 'NOT CONFIGURED'} tone={health?.alpacaKeySet ? 'ok' : 'warn'} />
              <StatRow label="Anthropic Key" value={health?.anthropicKeySet ? 'SET' : 'MISSING'} tone={health?.anthropicKeySet ? 'ok' : 'warn'} />
              <StatRow label="OpenAI Key" value={health?.openaiKeySet ? 'SET' : 'MISSING'} tone={health?.openaiKeySet ? 'ok' : 'warn'} />
              <StatRow label="Uptime" value={health ? `${Math.floor(health.uptime / 3600)}h` : 'N/A'} tone="neutral" />
            </div>
          </div>

          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 10 }}>WHAT YOU CAN DO HERE</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <FeatureRow title="Monitor" text="Portfolio, positions, trade outcomes, and live market state." />
              <FeatureRow title="Decide" text="Run rule-based or model-based decisions with confidence filtering." />
              <FeatureRow title="Control" text="Use manual approvals or auto-trade with risk guardrails." />
              <FeatureRow title="Improve" text="Backtest, compare strategies, and export training datasets." />
            </div>
          </div>

          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 10 }}>THEME</div>
            <ThemePicker
              compact
              value={theme}
              onChange={(next) => {
                setTheme(next)
                applyTheme(next)
              }}
            />
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.6, marginTop: 12 }}>
              Theme is persisted locally and reused across refresh, logout, and login.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

function SignalCanvas({ prices }: { prices: [string, { price: number; change24h: number }][] }) {
  const points = '0,84 20,79 40,81 60,70 80,75 100,63 120,66 140,54 160,58 180,49 200,43 220,39 240,42 260,34 280,29 300,18'
  const latency = prices.length > 0 ? `${(Math.abs(prices[0][1].change24h) + 0.3).toFixed(2)}s` : '0.94s'

  return (
    <div style={{
      background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg2) 94%, transparent), color-mix(in srgb, var(--bg3) 82%, transparent))',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '16px 14px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div className="landing-scanline" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontSize: 10, letterSpacing: '0.08em' }}>SIGNAL CANVAS</div>
        <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)', fontSize: 10 }}>Latency {latency}</div>
      </div>
      <svg viewBox="0 0 300 90" width="100%" height="130" style={{ display: 'block', marginBottom: 10 }}>
        <defs>
          <linearGradient id="line" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--accent2)" stopOpacity="0.65" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="300" height="90" fill="transparent" />
        {Array.from({ length: 11 }).map((_, i) => (
          <line key={i} x1={i * 30} y1="0" x2={i * 30} y2="90" stroke="var(--border)" strokeWidth="0.6" />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`h-${i}`} x1="0" y1={i * 18} x2="300" y2={i * 18} stroke="var(--border)" strokeWidth="0.6" />
        ))}
        <polyline points={points} fill="none" stroke="url(#line)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
        <TerminalCell label="Inference" value="ONLINE" tone="ok" />
        <TerminalCell label="Risk Gate" value="ACTIVE" tone="ok" />
        <TerminalCell label="Mode" value="PAPER" tone="warn" />
      </div>
    </div>
  )
}

function Pill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'neutral' }) {
  const color = tone === 'ok' ? 'var(--green)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)'
  return (
    <span style={{
      padding: '4px 8px',
      borderRadius: 999,
      border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
      background: `color-mix(in srgb, ${color} 16%, transparent)`,
      fontFamily: 'var(--font-mono)',
      fontSize: 9,
      color,
      letterSpacing: '0.08em',
    }}>
      {label}
    </span>
  )
}

function Badge({ text }: { text: string }) {
  return (
    <div style={{
      padding: '6px 8px',
      borderRadius: 6,
      background: 'var(--bg3)',
      border: '1px solid var(--border2)',
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      color: 'var(--text)',
    }}>
      {text}
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function StatRow({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'neutral' }) {
  const color = tone === 'ok' ? 'var(--green)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px dashed var(--border)', padding: '6px 0' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color, fontWeight: 700 }}>{value}</span>
    </div>
  )
}

function FeatureRow({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>{text}</div>
    </div>
  )
}

function TerminalCell({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? 'var(--green)' : 'var(--warn)'
  return (
    <div style={{ border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 7px', background: 'color-mix(in srgb, var(--bg3) 88%, transparent)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)', marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

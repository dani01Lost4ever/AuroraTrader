import { useEffect, useState, useCallback, useRef } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  PieChart, Pie, Cell, BarChart, Bar, ComposedChart, Line,
} from 'recharts'
import { api } from '../api'
import type { Stats, Trade, AgentConfig, EquityPoint, PortfolioDetail, AssetPnl, RiskStatus, HealthStatus, BenchmarkPoint, AlpacaPosition, LogEntry } from '../api'
import { StatCard } from '../components/StatCard'
import { PendingCard } from '../components/PendingCard'
import { ActionBadge } from '../components/ActionBadge'
import { LogsPanel } from '../components/LogsPanel'
import { TrainingPanel } from '../components/TrainingPanel'
import { useSocket } from '../hooks/useSocket'

function fmt(ts: string) {
  return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function inferStrategyLabel(trade: Trade): string {
  if (trade.strategy_label) return trade.strategy_label
  if (trade.strategy_id) return trade.strategy_id.toUpperCase()
  const match = trade.decision.reasoning.match(/^\[Auto(?:->|→)([^\]]+)\]/i)
  if (match) return `Auto -> ${match[1].trim()}`
  return '—'
}

const PIE_COLORS = [
  'var(--accent)', 'var(--accent2)', 'var(--green)', 'var(--warn)', 'var(--danger)',
  '#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#a4de6c',
]

// ── browser push notifications ─────────────────────────────────────────────
function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

function sendNotif(title: string, body: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' })
  }
}

// ── Health widget ──────────────────────────────────────────────────────────
function HealthWidget({ health }: { health: HealthStatus }) {
  const services: { label: string; ok: boolean }[] = [
    { label: 'MongoDB',   ok: health.mongodb },
    { label: 'Anthropic', ok: health.anthropicKeySet },
    { label: 'OpenAI',    ok: health.openaiKeySet },
    { label: 'Alpaca',    ok: health.alpacaKeySet },
  ]

  const lastCycleText = (() => {
    if (!health.lastCycleAt) return null
    const diff = Date.now() - new Date(health.lastCycleAt).getTime()
    const mins = Math.floor(diff / 60_000)
    return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`
  })()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 20 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em' }}>HEALTH</span>
      {services.map(s => (
        <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.ok ? 'var(--green)' : 'var(--danger)', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: s.ok ? 'var(--text)' : 'var(--muted)' }}>{s.label}</span>
        </span>
      ))}
      {lastCycleText && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
          Last cycle: <span style={{ color: 'var(--text)' }}>{lastCycleText}</span>
        </span>
      )}
      <span style={{
        marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10,
        color: health.status === 'ok' ? 'var(--green)' : 'var(--warn)',
      }}>
        {health.status === 'ok' ? '● OK' : '◌ DEGRADED'}
      </span>
    </div>
  )
}

// ── Trade Replay Modal ─────────────────────────────────────────────────────
function TradeReplayModal({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const snap = trade.market[trade.decision.asset]
  const indicators: { label: string; value: string | number }[] = snap ? [
    { label: 'Price',     value: `$${snap.price.toLocaleString()}` },
    { label: 'RSI 14',    value: snap.rsi_14 ?? '—' },
    { label: 'Change 24h', value: snap.change_24h !== undefined ? `${snap.change_24h >= 0 ? '+' : ''}${snap.change_24h.toFixed(2)}%` : '—' },
    { label: 'Volume 24h', value: snap.volume_24h !== undefined ? snap.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—' },
  ] : []

  const barData = snap ? [
    { name: 'RSI', value: snap.rsi_14 ?? 0 },
    { name: 'Confidence', value: trade.decision.confidence * 100 },
  ] : []

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 10,
          padding: 28, maxWidth: 520, width: '100%', margin: '0 16px',
          maxHeight: '80vh', overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ActionBadge action={trade.decision.action} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {trade.decision.asset}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
              {fmt(trade.timestamp)}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18,
            cursor: 'pointer', lineHeight: 1, padding: '0 4px',
          }}>✕</button>
        </div>

        {/* Details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', marginBottom: 16 }}>
          {[
            { label: 'Amount', value: `$${trade.decision.amount_usd.toLocaleString()}` },
            { label: 'Confidence', value: `${(trade.decision.confidence * 100).toFixed(0)}%` },
            ...(trade.outcome ? [
              { label: 'P&L', value: `${trade.outcome.pnl_usd >= 0 ? '+' : ''}$${trade.outcome.pnl_usd.toFixed(2)}` },
              { label: 'Outcome', value: trade.outcome.correct ? 'Correct' : 'Incorrect' },
            ] : []),
            ...indicators,
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)', letterSpacing: '0.08em' }}>{label.toUpperCase()}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>{String(value)}</span>
            </div>
          ))}
        </div>

        {/* Mini bar chart */}
        {barData.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 8, letterSpacing: '0.06em' }}>INDICATOR SNAPSHOT</div>
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={72} />
                <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                  {barData.map((d, i) => (
                    <Cell key={i} fill={d.value >= 70 ? 'var(--danger)' : d.value >= 50 ? 'var(--accent)' : 'var(--green)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Reasoning */}
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 8, letterSpacing: '0.06em' }}>REASONING</div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)',
            background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '10px 14px', lineHeight: 1.7, maxHeight: 180, overflowY: 'auto',
            whiteSpace: 'pre-wrap',
          }}>
            {trade.decision.reasoning || '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────
export function Overview() {
  const [stats, setStats]           = useState<Stats | null>(null)
  const [trades, setTrades]         = useState<Trade[]>([])
  const [pending, setPending]       = useState<Trade[]>([])
  const [config, setConfig]         = useState<AgentConfig | null>(null)
  const [equity, setEquity]         = useState<EquityPoint[]>([])
  const [benchmark, setBenchmark]   = useState<BenchmarkPoint[]>([])
  const [portfolio, setPortfolio]   = useState<PortfolioDetail | null>(null)
  const [perAsset, setPerAsset]     = useState<AssetPnl[]>([])
  const [risk, setRisk]             = useState<RiskStatus | null>(null)
  const [health, setHealth]         = useState<HealthStatus | null>(null)
  const [loading, setLoading]       = useState(true)
  const [togglingAuto, setTogglingAuto] = useState(false)
  const [wsStatus, setWsStatus]     = useState<'connecting' | 'live' | 'reconnecting'>('connecting')
  const [replayTrade, setReplayTrade] = useState<Trade | null>(null)
  const lastTradeIdRef              = useRef<string | null>(null)

  // Positions
  const [positions, setPositions]   = useState<AlpacaPosition[] | null>(null)
  const [posLoading, setPosLoading] = useState(true)

  // Pause/resume
  const [agentPaused, setAgentPaused] = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)

  // Live logs
  const [liveLogs, setLiveLogs]       = useState<LogEntry[]>([])
  const [logsOpen, setLogsOpen]       = useState(true)

  // ── data loaders ──────────────────────────────────────────────────────────
  const loadCore = useCallback(async () => {
    try {
      const [s, t, p, cfg, eq, port, pa, rs] = await Promise.all([
        api.stats(),
        api.trades(1, 100),
        api.pending(),
        api.getConfig(),
        api.equityHistory(200),
        api.portfolioDetail().catch(() => null),
        api.perAssetPnl(),
        api.riskStatus().catch(() => null),
      ])
      setStats(s)
      setTrades(t.trades)
      setPending(p.filter(x => !x.execution_error))
      setConfig(cfg)
      setEquity(eq)
      if (port) setPortfolio(port)
      setPerAsset(pa)
      if (rs) setRisk(rs)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    requestNotifPermission()
    loadCore()
    // Load health and benchmark (non-critical)
    api.health().then(setHealth).catch(() => {})
    api.benchmark().then(d => setBenchmark(d.points)).catch(() => {})

    // Agent status
    api.agentStatus().then(s => setAgentPaused(s.paused)).catch(() => {})

    // Initial live logs
    api.agentLogs(200).then(r => setLiveLogs(r.logs.slice().reverse())).catch(() => {})
      .finally(() => {})

    // Positions
    api.positions().then(p => setPositions(p)).catch(() => setPositions([]))
      .finally(() => setPosLoading(false))
  }, [loadCore])

  // Refresh everything every 90s as a safety net (WS covers live updates)
  useEffect(() => {
    const id = setInterval(loadCore, 90_000)
    return () => clearInterval(id)
  }, [loadCore])

  // Refresh positions every 60s
  useEffect(() => {
    const id = setInterval(() => {
      api.positions().then(setPositions).catch(() => {})
    }, 60_000)
    return () => clearInterval(id)
  }, [])


  // ── WebSocket live updates ─────────────────────────────────────────────
  useSocket(useCallback((ev) => {
    if (ev.type === 'connected') {
      setWsStatus('live')
    }
    if (ev.type === 'log_line') {
      const entry = ev.data as LogEntry
      setLiveLogs(prev => [...prev, entry].slice(-300))
    }
    if (ev.type === 'portfolio') {
      api.portfolioDetail().then(setPortfolio).catch(() => {})
    }
    if (ev.type === 'trade:new') {
      const trade = ev.data as Trade
      setTrades(prev => [trade, ...prev].slice(0, 100))
      if (trade.decision.action !== 'hold' && !trade.approved && !trade.execution_error && (trade.approval_mode ?? 'manual') === 'manual') {
        setPending(prev => [trade, ...prev.filter(p => p._id !== trade._id)])
        sendNotif(
          `New ${trade.decision.action.toUpperCase()} signal`,
          `${trade.decision.asset} · $${trade.decision.amount_usd.toLocaleString()} · ${(trade.decision.confidence * 100).toFixed(0)}% confidence`,
        )
      }
    }
    if (ev.type === 'trade:executed') {
      const trade = ev.data as Trade
      setTrades(prev => prev.map(t => t._id === trade._id ? trade : t))
      setPending(prev => prev.filter(p => p._id !== trade._id))
      if (lastTradeIdRef.current !== trade._id) {
        lastTradeIdRef.current = trade._id
        sendNotif(
          `Trade executed: ${trade.decision.action.toUpperCase()} ${trade.decision.asset}`,
          `$${trade.decision.amount_usd.toLocaleString()} @ ~$${trade.market[trade.decision.asset]?.price.toLocaleString() ?? '?'}`,
        )
      }
      Promise.all([api.stats(), api.equityHistory(200), api.perAssetPnl()]).then(([s, eq, pa]) => {
        setStats(s)
        setEquity(eq)
        setPerAsset(pa)
      }).catch(() => {})
    }
  }, []))

  // ── chart data ─────────────────────────────────────────────────────────
  const cumulativePnl = trades
    .filter(t => t.outcome)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .reduce<{ date: string; pnl: number }[]>((acc, t) => {
      const prev = acc.length ? acc[acc.length - 1].pnl : 0
      acc.push({ date: fmt(t.timestamp), pnl: parseFloat((prev + t.outcome!.pnl_usd).toFixed(2)) })
      return acc
    }, [])

  const pnlColor = stats && parseFloat(stats.total_pnl_usd) >= 0 ? 'var(--green)' : 'var(--danger)'

  // Build a lookup for benchmark by ts prefix (date+hour) for merging
  const benchmarkMap = new Map<string, number>()
  benchmark.forEach(b => benchmarkMap.set(b.ts, b.benchmark))

  // Equity / drawdown chart — merge benchmark points
  const equityChartData = equity.map((e, i) => {
    const tsKey = e.ts
    // Try exact match first, then use indexed fallback from benchmark array
    const bm = benchmarkMap.get(tsKey) ?? benchmark[i]?.benchmark ?? undefined
    return {
      ts: new Date(e.ts).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      equity: parseFloat(e.equity.toFixed(2)),
      peak: parseFloat(e.peak.toFixed(2)),
      drawdown: parseFloat(((e.equity - e.peak) / e.peak * 100).toFixed(2)),
      benchmark: bm !== undefined ? parseFloat(bm.toFixed(2)) : undefined,
    }
  })

  // Portfolio pie
  const pieData: { name: string; value: number }[] = []
  if (portfolio) {
    if (portfolio.cash > 0) pieData.push({ name: 'Cash', value: parseFloat(portfolio.cash.toFixed(2)) })
    ;(portfolio.positions ?? []).forEach(p => pieData.push({ name: p.asset, value: parseFloat(p.market_value.toFixed(2)) }))
  }

  // Per-asset bar
  const barData = perAsset.map(a => ({ asset: a.asset.replace('/USD', ''), pnl: a.total_pnl, wins: a.win_rate }))
  const failedTrades = trades.filter(t => !!t.execution_error)

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
      <span style={{ animation: 'pulse 1.2s ease infinite' }}>LOADING SYSTEM DATA...</span>
    </div>
  )

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--accent)' }}>
          TRADING AGENT
        </h1>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: wsStatus === 'live' ? 'var(--green)' : wsStatus === 'reconnecting' ? 'var(--warn)' : 'var(--muted)',
        }}>
          {wsStatus === 'live' ? '● LIVE' : wsStatus === 'reconnecting' ? '◌ RECONNECTING' : '○ CONNECTING'}
          {' · '}{new Date().toLocaleTimeString()}
        </span>

        {/* Circuit breaker badge */}
        {risk?.circuitBreakerActive && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)',
            background: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)',
            borderRadius: 4, padding: '2px 8px', letterSpacing: '0.06em',
          }}>
            ⚡ CIRCUIT BREAKER · {risk.circuitBreakerReason}
          </span>
        )}

        {/* Pause/Resume agent button */}
        <button
          onClick={async () => {
            setPauseLoading(true)
            try {
              const r = agentPaused ? await api.resumeAgent() : await api.pauseAgent()
              setAgentPaused(r.paused)
            } finally { setPauseLoading(false) }
          }}
          disabled={pauseLoading}
          style={{
            padding: '5px 14px', borderRadius: 6,
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
            background: agentPaused ? 'rgba(239,68,68,0.12)' : 'rgba(var(--accent-rgb,0,212,170),0.1)',
            color: agentPaused ? 'var(--danger)' : 'var(--accent)',
            border: `1px solid ${agentPaused ? 'var(--danger)' : 'var(--accent)'}`,
            cursor: pauseLoading ? 'wait' : 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {agentPaused ? '▶ Resume' : '⏸ Pause'}
        </button>

        {/* Auto-trade toggle */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: config?.autoApprove ? 'var(--warn)' : 'var(--muted)' }}>
            {config?.autoApprove ? '🤖 AUTO-TRADE ON' : 'MANUAL APPROVAL'}
          </span>
          <button
            onClick={async () => {
              if (!config) return
              setTogglingAuto(true)
              try {
                const updated = await api.setConfig({ autoApprove: !config.autoApprove })
                setConfig(updated)
              } finally { setTogglingAuto(false) }
            }}
            disabled={togglingAuto || !config}
            title={config?.autoApprove ? 'Click to require manual approval' : 'Click to let agent trade automatically'}
            style={{
              position: 'relative', width: 44, height: 24, borderRadius: 12, padding: 0,
              background: config?.autoApprove ? 'var(--warn)' : 'var(--bg3)',
              border: `1px solid ${config?.autoApprove ? 'var(--warn)' : 'var(--border2)'}`,
              transition: 'background 0.2s, border-color 0.2s',
              cursor: togglingAuto ? 'wait' : 'pointer',
            }}
          >
            <span style={{
              position: 'absolute', top: 3, left: config?.autoApprove ? 22 : 3,
              width: 16, height: 16, borderRadius: '50%',
              background: config?.autoApprove ? '#000' : 'var(--muted)',
              transition: 'left 0.2s', display: 'block',
            }} />
          </button>
        </div>
      </div>

      {/* ── Health widget ── */}
      {health && <HealthWidget health={health} />}

      {/* ── Stats row ── */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px,1fr))', gap: 12, marginBottom: 28 }}>
          <StatCard label="Total decisions" value={stats.total_decisions} />
          <StatCard label="Executed trades" value={stats.executed_trades} />
          <StatCard label="Win rate" value={`${stats.win_rate}%`} accent="accent" />
          <StatCard label="Total P&L" value={`$${stats.total_pnl_usd}`}
            accent={parseFloat(stats.total_pnl_usd) >= 0 ? 'green' : 'danger'} />
          {risk && (
            <StatCard label="Open positions" value={`${risk.openPositions} / ${risk.maxOpenPositions}`}
              accent={risk.openPositions >= risk.maxOpenPositions ? 'danger' : 'accent'} />
          )}
          <StatCard label="Dataset samples" value={stats.dataset_size} accent="accent2" sub="profitable trades" />
        </div>
      )}

      {/* ── Pending approvals ── */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)', letterSpacing: '0.08em', marginBottom: 12 }}>
            ⚠ PENDING APPROVAL ({pending.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px,1fr))', gap: 12 }}>
            {pending.map(t => <PendingCard key={t._id} trade={t} onDone={loadCore} />)}
          </div>
        </div>
      )}

      {/* ── Alpaca Positions panel ── */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginBottom: 28 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 12 }}>
          OPEN POSITIONS
        </div>
        {posLoading ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading positions...</div>
        ) : !positions || positions.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>No open positions</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Asset', 'Side', 'Qty', 'Entry Price', 'Current Price', 'Market Value', 'Unrealized P&L', 'P&L %'].map(h => (
                    <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => {
                  const pl = parseFloat(pos.unrealized_pl)
                  const plPct = parseFloat(pos.unrealized_plpc) * 100
                  const plColor = pl >= 0 ? 'var(--green)' : 'var(--danger)'
                  return (
                    <tr key={pos.symbol} style={{ borderBottom: '1px solid var(--border2)' }}>
                      <td style={{ padding: '7px 12px', color: 'var(--text)', fontWeight: 600 }}>{pos.symbol}</td>
                      <td style={{ padding: '7px 12px', color: pos.side === 'long' ? 'var(--green)' : 'var(--danger)', textTransform: 'uppercase' }}>{pos.side}</td>
                      <td style={{ padding: '7px 12px', color: 'var(--text)' }}>{parseFloat(pos.qty).toFixed(6)}</td>
                      <td style={{ padding: '7px 12px', color: 'var(--text)' }}>${parseFloat(pos.avg_entry_price).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td style={{ padding: '7px 12px', color: 'var(--text)' }}>${parseFloat(pos.current_price).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td style={{ padding: '7px 12px', color: 'var(--text)' }}>${parseFloat(pos.market_value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td style={{ padding: '7px 12px', color: plColor, fontWeight: 600 }}>{pl >= 0 ? '+' : ''}${pl.toFixed(2)}</td>
                      <td style={{ padding: '7px 12px', color: plColor }}>{plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Portfolio + Per-asset row ── */}
      {(pieData.length > 0 || perAsset.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: pieData.length > 0 && perAsset.length > 0 ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 28 }}>

          {/* Portfolio Pie */}
          {pieData.length > 0 && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 12 }}>
                PORTFOLIO BREAKDOWN
                {portfolio && (
                  <span style={{ marginLeft: 12, color: 'var(--text)' }}>
                    Equity: <span style={{ color: 'var(--accent)' }}>${portfolio.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </span>
                )}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData} cx="50%" cy="50%"
                    innerRadius={52} outerRadius={82}
                    dataKey="value" nameKey="name"
                    paddingAngle={2}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="var(--bg2)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}
                    formatter={(v: any, _name: any, props: any) => [
                      `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                      props.payload.name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Custom legend */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 4 }}>
                {pieData.map((d, i) => {
                  const total = pieData.reduce((s, x) => s + x.value, 0)
                  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0'
                  return (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {d.name} <span style={{ color: 'var(--text)' }}>{pct}%</span>
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Positions table */}
              {portfolio && portfolio.positions.length > 0 && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  {portfolio.positions.map(p => (
                    <div key={p.asset} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                      <span style={{ color: 'var(--text)' }}>{p.asset}</span>
                      <span style={{ color: 'var(--muted)' }}>{p.qty.toFixed(6)} @ ${p.entry_price.toLocaleString()}</span>
                      <span style={{ color: p.unrealized_pl >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                        {p.unrealized_pl >= 0 ? '+' : ''}{p.unrealized_plpc.toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Per-asset P&L */}
          {perAsset.length > 0 && (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 12 }}>
                PER-ASSET P&L
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="asset" tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}
                    formatter={(v: any, name: string) => name === 'pnl' ? [`$${Number(v).toFixed(2)}`, 'P&L'] : [`${Number(v).toFixed(1)}%`, 'Win rate']}
                  />
                  <ReferenceLine x={0} stroke="var(--border2)" />
                  <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
                    {barData.map((d, i) => (
                      <Cell key={i} fill={d.pnl >= 0 ? 'var(--green)' : 'var(--danger)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Per-asset stats table */}
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {perAsset.map(a => (
                  <div key={a.asset} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11, fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text)' }}>{a.asset}</span>
                    <span style={{ color: 'var(--muted)' }}>{a.trade_count} trades · {a.win_rate.toFixed(1)}% win</span>
                    <span style={{ color: a.total_pnl >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                      {a.total_pnl >= 0 ? '+' : ''}${a.total_pnl.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Equity curve + Drawdown ── */}
      {equityChartData.length > 1 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em' }}>
              EQUITY CURVE &amp; DRAWDOWN
            </div>
            {benchmark.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
                <span style={{ width: 16, height: 1, background: 'var(--muted)', display: 'inline-block', borderRadius: 1, opacity: 0.6 }} />
                BTC B&amp;H
              </div>
            )}
          </div>
          {/* Equity vs peak + benchmark */}
          <div style={{ marginBottom: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>Equity ($)</div>
          <ResponsiveContainer width="100%" height={130}>
            <ComposedChart data={equityChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="ts" tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toLocaleString()}`} width={68} />
              <Tooltip
                contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text)' }}
                formatter={(v: any, name: string) => {
                  if (name === 'benchmark') return [`$${Number(v).toLocaleString()}`, 'BTC B&H']
                  return [`$${Number(v).toLocaleString()}`, name === 'equity' ? 'Equity' : 'Peak']
                }}
              />
              <Area type="monotone" dataKey="peak" stroke="var(--border2)" strokeWidth={1} fill="none" strokeDasharray="4 2" dot={false} />
              <Area type="monotone" dataKey="equity" stroke="var(--accent)" strokeWidth={1.5} fill="url(#eqGrad)" dot={false} />
              {benchmark.length > 0 && (
                <Line type="monotone" dataKey="benchmark" stroke="var(--muted)" strokeWidth={1} dot={false} strokeDasharray="4 2" connectNulls strokeOpacity={0.6} />
              )}
            </ComposedChart>
          </ResponsiveContainer>

          {/* Drawdown % */}
          <div style={{ marginTop: 16, marginBottom: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>Drawdown (%)</div>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={equityChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis dataKey="ts" tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={40} />
              <Tooltip
                contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text)' }}
                formatter={(v: any) => [`${Number(v).toFixed(2)}%`, 'Drawdown']}
              />
              <ReferenceLine y={0} stroke="var(--border2)" />
              <Area type="monotone" dataKey="drawdown" stroke="var(--danger)" strokeWidth={1.5} fill="url(#ddGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Cumulative P&L ── */}
      {cumulativePnl.length > 1 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 16 }}>
            CUMULATIVE P&L (USD)
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={cumulativePnl} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={pnlColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={pnlColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={54} />
              <Tooltip
                contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}
                labelStyle={{ color: 'var(--muted)' }} itemStyle={{ color: pnlColor }}
                formatter={(v: any) => [`$${v}`, 'P&L']}
              />
              <ReferenceLine y={0} stroke="var(--border2)" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="pnl" stroke={pnlColor} strokeWidth={1.5} fill="url(#pnlGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Agent logs + Live logs + Failed trades ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: 12, marginBottom: 28 }}>
        <LogsPanel />

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div
            onClick={() => setLogsOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: logsOpen ? '1px solid var(--border)' : 'none', cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', flex: 1 }}>
              LIVE LOGS
            </span>
            {wsStatus === 'live' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--green)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 2s ease infinite' }} />
                LIVE
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{logsOpen ? '▲' : '▼'}</span>
          </div>
          {logsOpen && (
            <div style={{ height: 280, overflowY: 'auto', padding: '8px 16px', background: 'var(--bg3)' }}>
              {liveLogs.length === 0 ? (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>No logs yet...</span>
              ) : (
                liveLogs.map((log, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 2, fontSize: 10, fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--muted)', flexShrink: 0 }}>
                      {new Date(log.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span style={{
                      flexShrink: 0, minWidth: 36, textTransform: 'uppercase', fontSize: 9, letterSpacing: '0.06em',
                      color: log.level === 'error' ? 'var(--danger)' : log.level === 'warn' ? 'var(--warn)' : 'var(--muted)',
                    }}>
                      [{log.level}]
                    </span>
                    <span style={{ color: log.level === 'error' ? 'var(--danger)' : log.level === 'warn' ? 'var(--warn)' : 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {log.msg}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)', letterSpacing: '0.08em', flex: 1 }}>
              FAILED TRADES ({failedTrades.length})
            </span>
          </div>
          <div style={{ height: 280, overflowY: 'auto', padding: '8px 12px' }}>
            {failedTrades.length === 0 ? (
              <div style={{ padding: '40px 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                No failed trades
              </div>
            ) : (
              failedTrades.map(t => (
                <div key={t._id} style={{ padding: '8px 6px', borderBottom: '1px solid var(--border2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmt(t.timestamp)}</span>
                    <ActionBadge action={t.decision.action} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{t.decision.asset}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>${t.decision.amount_usd.toLocaleString()}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', marginBottom: 4 }}>
                    Strategy: {inferStrategyLabel(t)}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--danger)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {t.execution_error}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Fine-tuning pipeline ── */}
      <div style={{ marginBottom: 28 }}>
        <TrainingPanel />
      </div>

      {/* ── Decision log ── */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em' }}>
          DECISION LOG ({trades.length}) — click row to replay
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Time', 'Action', 'Asset', 'Strategy', 'Amount', 'Price', 'RSI', 'Confidence', 'SL / TP', 'P&L', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => {
                const snap = t.market[t.decision.asset]
                const pnl = t.outcome?.pnl_usd
                const strategyLabel = inferStrategyLabel(t)
                return (
                  <tr
                    key={t._id}
                    onClick={() => setReplayTrade(t)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.04)'}
                    onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'}
                  >
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmt(t.timestamp)}</td>
                    <td style={{ padding: '10px 16px' }}><ActionBadge action={t.decision.action} /></td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{t.decision.asset}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: strategyLabel === '—' ? 'var(--muted)' : 'var(--accent2)', whiteSpace: 'nowrap' }}>{strategyLabel}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>${t.decision.amount_usd.toLocaleString()}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{snap ? `$${snap.price.toLocaleString()}` : '—'}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: snap?.rsi_14 !== undefined ? (snap.rsi_14 > 70 ? 'var(--danger)' : snap.rsi_14 < 30 ? 'var(--green)' : 'var(--text)') : 'var(--muted)' }}>
                      {snap?.rsi_14 ?? '—'}
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{(t.decision.confidence * 100).toFixed(0)}%</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {t.sl_price ? (
                        <span>
                          <span style={{ color: 'var(--danger)' }}>${t.sl_price.toLocaleString()}</span>
                          {t.tp_price && <span> / <span style={{ color: 'var(--green)' }}>${t.tp_price.toLocaleString()}</span></span>}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: pnl === undefined ? 'var(--muted)' : pnl >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                      {pnl !== undefined ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 10, color: t.executed ? 'var(--green)' : t.execution_error ? 'var(--danger)' : t.approved && (t.approval_mode ?? 'manual') === 'auto' ? 'var(--accent)' : t.approved ? 'var(--muted)' : t.decision.action === 'hold' ? 'var(--muted)' : 'var(--warn)' }}>
                      {t.executed ? 'EXECUTED' : t.execution_error ? 'FAILED' : t.approved && (t.approval_mode ?? 'manual') === 'auto' ? 'AUTO' : t.approved ? 'REJECTED' : t.decision.action === 'hold' ? 'HOLD' : 'PENDING'}
                    </td>
                  </tr>
                )
              })}
              {trades.length === 0 && (
                <tr><td colSpan={11} style={{ padding: '40px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
                  Waiting for first agent cycle...
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Trade Replay Modal ── */}
      {replayTrade && (
        <TradeReplayModal trade={replayTrade} onClose={() => setReplayTrade(null)} />
      )}
    </div>
  )
}

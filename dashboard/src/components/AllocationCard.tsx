import { useEffect, useState } from 'react'
import { api } from '../api'

interface PositionDetail {
  asset: string
  qty: number
  market_value: number
  unrealized_pl: number
  unrealized_plpc: number
  current_price: number
  entry_price: number
}

interface AllocationRow {
  asset: string
  value: number
  allocation: number
  kellySizeUsd: number
  atrSizeUsd: number | null
}

const SEGMENT_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444']
const PAYOFF_RATIO = 1.5
const ATR_RISK_PCT = 0.01 // 1% of equity per trade

function computeKellyHalf(winRate: number, payoffRatio: number): number {
  // half-Kelly = max(0, (payoffRatio * winRate - (1 - winRate)) / payoffRatio * 0.5)
  const raw = (payoffRatio * winRate - (1 - winRate)) / payoffRatio * 0.5
  return Math.max(0, raw)
}

function getSignal(value: number, kellySizeUsd: number): { label: string; color: string } {
  if (kellySizeUsd <= 0) return { label: 'On target', color: 'var(--muted)' }
  if (value > kellySizeUsd * 1.1) return { label: 'Over', color: '#f59e0b' }
  if (value < kellySizeUsd * 0.9) return { label: 'Under', color: '#3b82f6' }
  return { label: 'On target', color: 'var(--green)' }
}

export function AllocationCard({ marketSnapshot }: { marketSnapshot?: Record<string, any> }) {
  const [rows, setRows] = useState<AllocationRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [rawPositions, stats] = await Promise.all([
          api.positions() as unknown as Promise<PositionDetail[]>,
          api.stats(),
        ])

        if (cancelled) return

        const positions = rawPositions.filter(p => p.market_value > 0)
        if (positions.length === 0) {
          setRows([])
          setLoading(false)
          return
        }

        const equity = positions.reduce((s, p) => s + p.market_value, 0)
        const winRate = parseFloat(stats.win_rate) / 100
        const kellyFraction = computeKellyHalf(winRate, PAYOFF_RATIO)
        const kellySizeUsd = kellyFraction * equity

        const computed: AllocationRow[] = positions.map(p => {
          const allocation = equity > 0 ? (p.market_value / equity) * 100 : 0

          let atrSizeUsd: number | null = null
          if (marketSnapshot) {
            const snap = marketSnapshot[p.asset]
            if (snap && snap.atr14 && p.current_price > 0) {
              const atrPct = snap.atr14 / p.current_price
              if (atrPct > 0) {
                atrSizeUsd = (equity * ATR_RISK_PCT) / atrPct
              }
            }
          }

          return {
            asset: p.asset,
            value: p.market_value,
            allocation,
            kellySizeUsd,
            atrSizeUsd,
          }
        })

        setRows(computed)
      } catch {
        // silently fail — positions may not be available
        setRows([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [marketSnapshot])

  if (loading) return null
  if (rows.length === 0) return null

  const totalValue = rows.reduce((s, r) => s + r.value, 0)

  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 20,
      marginBottom: 28,
    }}>
      {/* Header */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--muted)',
        letterSpacing: '0.08em',
        marginBottom: 16,
      }}>
        ALLOCATION SIZING
      </div>

      {/* Stacked bar */}
      <div style={{
        display: 'flex',
        height: 18,
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: 16,
        gap: 1,
      }}>
        {rows.map((row, i) => (
          <div
            key={row.asset}
            title={`${row.asset}: ${row.allocation.toFixed(1)}%`}
            style={{
              flex: row.allocation,
              background: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
              minWidth: row.allocation > 0 ? 2 : 0,
            }}
          />
        ))}
      </div>

      {/* Legend for stacked bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 16 }}>
        {rows.map((row, i) => (
          <div key={row.asset} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
              display: 'inline-block',
              flexShrink: 0,
            }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
              {row.asset} <span style={{ color: 'var(--text)' }}>{row.allocation.toFixed(1)}%</span>
            </span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Asset', 'Value ($)', 'Allocation (%)', 'Kelly Size ($)', 'ATR Size ($)', 'Signal'].map(h => (
                <th
                  key={h}
                  style={{
                    padding: '6px 12px',
                    textAlign: 'left',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--muted)',
                    letterSpacing: '0.06em',
                    fontWeight: 400,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const signal = getSignal(row.value, row.kellySizeUsd)
              return (
                <tr key={row.asset} style={{ borderBottom: '1px solid var(--border2)' }}>
                  <td style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                      display: 'inline-block',
                      flexShrink: 0,
                    }} />
                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>{row.asset}</span>
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--text)' }}>
                    ${row.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--text)' }}>
                    {row.allocation.toFixed(2)}%
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--text)' }}>
                    ${row.kellySizeUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--muted)' }}>
                    {row.atrSizeUsd !== null
                      ? `$${row.atrSizeUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                      : '—'}
                  </td>
                  <td style={{ padding: '7px 12px' }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      fontWeight: 600,
                      color: signal.color,
                      background: signal.color + '1a',
                      padding: '2px 8px',
                      borderRadius: 4,
                      letterSpacing: '0.04em',
                    }}>
                      {signal.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {/* Footer row: totals */}
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 12px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>TOTAL</td>
              <td style={{ padding: '6px 12px', color: 'var(--text)', fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </td>
              <td style={{ padding: '6px 12px', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>100.00%</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

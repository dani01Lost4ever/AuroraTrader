import { useEffect, useState } from 'react'
import type { Page } from '../App'
import { api } from '../api'
import type { LivePrices, AuthUser } from '../api'

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'overview',  label: 'Overview',  icon: '▦' },
  { id: 'charts',    label: 'Charts',    icon: '↗' },
  { id: 'assets',    label: 'Assets',    icon: '⊞' },
  { id: 'tokens',    label: 'Cost',      icon: '◎' },
  { id: 'settings',    label: 'Settings',    icon: '⚙' },
  { id: 'strategies',  label: 'Strategies',  icon: '⊗' },
  { id: 'backtest',    label: 'Backtest',    icon: '⟲' },
  { id: 'reasoning', label: 'Reasoning', icon: '◉' },
  { id: 'auditlog',  label: 'Audit',     icon: '☰' },
  { id: 'wiki',      label: 'Wiki',      icon: '⊕' },
]

interface NavProps {
  current: Page
  onNavigate: (page: Page) => void
  onLogout: () => void
  me: AuthUser | null
}

function PriceTicker() {
  const [prices, setPrices] = useState<LivePrices>({})

  useEffect(() => {
    const fetchPrices = () => {
      api.livePrices().then(setPrices).catch(() => {})
    }
    fetchPrices()
    const id = setInterval(fetchPrices, 30_000)
    return () => clearInterval(id)
  }, [])

  const assets = Object.keys(prices)
  if (assets.length === 0) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 0,
      overflow: 'hidden', flexShrink: 1, minWidth: 0,
    }}>
      {assets.map((asset, i) => {
        const { price, change24h } = prices[asset]
        const positive = change24h >= 0
        const color = positive ? 'var(--green)' : 'var(--danger)'
        const sign  = positive ? '+' : ''
        const label = asset.replace('/USD', '')
        const fmt   = price >= 1000
          ? price.toLocaleString(undefined, { maximumFractionDigits: 0 })
          : price >= 1
            ? price.toFixed(3)
            : price.toFixed(6)
        return (
          <span key={asset} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            {i > 0 && (
              <span style={{ color: 'var(--border2)', margin: '0 8px', fontFamily: 'var(--font-mono)', fontSize: 10 }}>·</span>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--text)' }}>{label}</span>
              {' '}
              <span style={{ color: 'var(--text)' }}>${fmt}</span>
              {' '}
              <span style={{ color }}>{sign}{change24h.toFixed(2)}%</span>
            </span>
          </span>
        )
      })}
    </div>
  )
}

export function Nav({ current, onNavigate, onLogout, me }: NavProps) {
  const items = me?.role === 'admin'
    ? [...NAV_ITEMS, { id: 'admin' as Page, label: 'Engines', icon: '⚑' }]
    : NAV_ITEMS
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 100,
      background: 'var(--nav-bg)',
      borderBottom: '1px solid var(--nav-border)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px', height: 52,
      gap: 4,
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 28, flexShrink: 0 }}>
        <span style={{ fontSize: 18, color: 'var(--accent)', lineHeight: 1 }}>◈</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600,
          color: 'var(--text)', letterSpacing: '0.06em',
        }}>
          TRADING<span style={{ color: 'var(--accent)' }}>AGENT</span>
        </span>
      </div>

      {/* Nav items */}
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 11,
            fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
            display: 'flex', alignItems: 'center', gap: 7,
            background: current === item.id ? 'rgba(var(--accent-rgb, 0,212,170), 0.1)' : 'transparent',
            color: current === item.id ? 'var(--accent)' : 'var(--muted)',
            border: current === item.id
              ? '1px solid rgba(var(--accent-rgb, 0,212,170), 0.25)'
              : '1px solid transparent',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => {
            if (current !== item.id) {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'
              ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
            }
          }}
          onMouseLeave={e => {
            if (current !== item.id) {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)'
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>{item.icon}</span>
          {item.label}
        </button>
      ))}

      {/* Price ticker */}
      <div style={{ marginLeft: 16, flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <PriceTicker />
      </div>

      {/* Logout */}
      <button
        onClick={onLogout}
        style={{
          marginLeft: 8, padding: '6px 14px', borderRadius: 6, fontSize: 11,
          fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'transparent', color: 'var(--muted)',
          border: '1px solid transparent', transition: 'all 0.15s', cursor: 'pointer',
          flexShrink: 0,
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)'
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.3)'
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)'
          ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'
        }}
      >
        <span style={{ fontSize: 13 }}>⏻</span>
        Logout
      </button>
    </nav>
  )
}
